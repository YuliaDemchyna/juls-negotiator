import axios from 'axios';
import { logger } from '../utils/logger';

export interface EmailData {
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: string; // Base64 encoded content
    type: string; // MIME type
  }>;
}

export interface InvoiceData {
  userId: string;
  userName: string;
  userEmail: string;
  phoneNumber: string;
  amount: number;
  debtBefore: number;
  debtAfter: number;
  invoiceDate: Date;
  dueDate: Date;
}

export class EmailService {
  private resendApiKey: string;
  private fromEmail: string;
  private carboneApiKey: string;
  private carboneTemplateId: string;
  private resendApiUrl = 'https://api.resend.com';
  private carboneApiUrl = 'https://api.carbone.io';

  constructor() {
    this.resendApiKey = process.env.RESEND_API_KEY || '';
    this.fromEmail =
      process.env.RESEND_FROM_EMAIL || 'noreply@debtcollection.com';
    this.carboneApiKey = process.env.CARBONE_API_KEY || '';
    this.carboneTemplateId = process.env.CARBONE_TEMPLATE_ID || '';
  }

  /**
   * Generate invoice PDF using Carbone.io
   */
  private async generateInvoicePDF(
    data: InvoiceData
  ): Promise<{ filename: string; content: string; invoiceId: string }> {
    try {
      if (
        process.env.NODE_ENV === 'production' &&
        this.carboneApiKey &&
        this.carboneTemplateId
      ) {
        logger.info('Generating invoice with Carbone.io', {
          userId: data.userId,
        });

        const invoiceId = `INV-${Date.now()}`;
        const carboneData = {
          invoice_number: invoiceId,
          invoice_date: data.invoiceDate.toISOString().split('T')[0],
          due_date: data.dueDate.toISOString().split('T')[0],
          customer: {
            name: data.userName,
            email: data.userEmail,
            phone: data.phoneNumber,
          },
          payment: {
            amount: data.amount.toFixed(2),
            debt_before: data.debtBefore.toFixed(2),
            debt_after: data.debtAfter.toFixed(2),
          },
          company: {
            name: 'Debt Collection Services',
            address: '123 Business Street, Suite 100',
            city: 'Business City, BC 12345',
            phone: '(555) 123-4567',
            email: 'billing@debtcollection.com',
          },
        };

        // Step 1: Render the template with data
        const renderResponse = await axios.post(
          `${this.carboneApiUrl}/render/${this.carboneTemplateId}`,
          { data: carboneData },
          {
            headers: {
              Authorization: `Bearer ${this.carboneApiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const renderId = renderResponse.data.renderId;

        // Step 2: Download the generated PDF
        const downloadResponse = await axios.get(
          `${this.carboneApiUrl}/render/${renderId}`,
          {
            headers: {
              Authorization: `Bearer ${this.carboneApiKey}`,
            },
            responseType: 'arraybuffer',
          }
        );

        // Convert to base64 for email attachment
        const pdfContent = Buffer.from(downloadResponse.data).toString(
          'base64'
        );

        return {
          filename: `${invoiceId}.pdf`,
          content: pdfContent,
          invoiceId,
        };
      }

      // Mock implementation for development/testing
      const mockInvoiceId = `MOCK-INV-${Date.now()}`;
      logger.info('Generated mock invoice PDF', {
        userId: data.userId,
        invoiceId: mockInvoiceId,
      });

      // Create a simple mock PDF content (this would be a real PDF in production)
      const mockPdfContent = this.createMockInvoicePDF(data, mockInvoiceId);

      return {
        filename: `${mockInvoiceId}.pdf`,
        content: Buffer.from(mockPdfContent).toString('base64'),
        invoiceId: mockInvoiceId,
      };
    } catch (error) {
      logger.error('Failed to generate invoice PDF', {
        error,
        userId: data.userId,
      });
      throw new Error('Invoice PDF generation failed');
    }
  }

  /**
   * Create mock PDF content for development
   */
  private createMockInvoicePDF(data: InvoiceData, invoiceId: string): string {
    return `%PDF-1.4
1 0 obj
<<
/Type /Catalog
/Pages 2 0 R
>>
endobj

2 0 obj
<<
/Type /Pages
/Kids [3 0 R]
/Count 1
>>
endobj

3 0 obj
<<
/Type /Page
/Parent 2 0 R
/MediaBox [0 0 612 792]
/Contents 4 0 R
>>
endobj

4 0 obj
<<
/Length 200
>>
stream
BT
/F1 12 Tf
50 750 Td
(INVOICE: ${invoiceId}) Tj
0 -20 Td
(Customer: ${data.userName}) Tj
0 -20 Td
(Amount: $${data.amount.toFixed(2)}) Tj
0 -20 Td
(Date: ${data.invoiceDate.toDateString()}) Tj
0 -20 Td
(Due: ${data.dueDate.toDateString()}) Tj
ET
endstream
endobj

xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000198 00000 n 
trailer
<<
/Size 5
/Root 1 0 R
>>
startxref
400
%%EOF`;
  }

  /**
   * Send email with invoice attachment using Resend API
   */
  async sendInvoiceEmail(
    invoiceData: InvoiceData
  ): Promise<{ emailId: string; success: boolean; invoiceId: string }> {
    try {
      // Generate invoice PDF
      const invoice = await this.generateInvoicePDF(invoiceData);

      // Prepare email content
      const isFullPayment = invoiceData.debtAfter === 0;
      const emailHtml = this.generateInvoiceEmailHTML(
        invoiceData.userName,
        invoiceData.amount,
        invoiceData.debtAfter,
        isFullPayment,
        invoice.invoiceId
      );

      // Prepare email with attachment
      const emailData: EmailData = {
        to: invoiceData.userEmail,
        subject: `Payment Invoice ${invoice.invoiceId} - $${invoiceData.amount.toFixed(2)}`,
        html: emailHtml,
        attachments: [
          {
            filename: invoice.filename,
            content: invoice.content,
            type: 'application/pdf',
          },
        ],
      };

      // Send email
      const result = await this.sendEmail(emailData);

      return {
        ...result,
        invoiceId: invoice.invoiceId,
      };
    } catch (error) {
      logger.error('Failed to send invoice email', {
        error,
        userEmail: invoiceData.userEmail,
      });
      throw new Error('Invoice email sending failed');
    }
  }

  /**
   * Send email using Resend API
   */
  async sendEmail(
    data: EmailData
  ): Promise<{ emailId: string; success: boolean }> {
    try {
      // In production, use actual Resend API
      if (process.env.NODE_ENV === 'production' && this.resendApiKey) {
        logger.info('Sending email via Resend', {
          to: data.to,
          subject: data.subject,
        });

        const response = await axios.post(
          `${this.resendApiUrl}/emails`,
          {
            from: this.fromEmail,
            to: [data.to],
            subject: data.subject,
            html: data.html,
            attachments: data.attachments?.map(att => ({
              filename: att.filename,
              content: att.content,
              type: att.type,
            })),
          },
          {
            headers: {
              Authorization: `Bearer ${this.resendApiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );

        return {
          emailId: response.data.id,
          success: true,
        };
      }

      // Mock implementation for development/testing
      const mockEmailId = `MOCK-EMAIL-${Date.now()}`;

      logger.info('Mock email sent', {
        emailId: mockEmailId,
        to: data.to,
        subject: data.subject,
        from: this.fromEmail,
        attachments: data.attachments?.length || 0,
      });

      // Log email content in development
      if (process.env.NODE_ENV === 'development') {
        logger.debug('Email content', {
          html: data.html.substring(0, 200) + '...',
          attachmentCount: data.attachments?.length || 0,
        });
      }

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 300));

      return {
        emailId: mockEmailId,
        success: true,
      };
    } catch (error) {
      logger.error('Failed to send email', { error, to: data.to });
      throw new Error('Email sending failed');
    }
  }

  /**
   * Generate invoice email HTML - with attachment instead of download link
   */
  generateInvoiceEmailHTML(
    userName: string,
    amount: number,
    remainingDebt: number,
    isFullPayment: boolean,
    invoiceId: string
  ): string {
    const paymentMessage = isFullPayment
      ? 'This payment will clear your entire debt. Thank you for settling your account.'
      : `After this payment, your remaining debt will be $${remainingDebt.toFixed(2)}.`;

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Payment Invoice</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .amount { font-size: 24px; font-weight: bold; color: #4CAF50; }
        .invoice-info { background-color: #e8f5e8; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Payment Invoice ${invoiceId}</h1>
        </div>
        <div class="content">
          <p>Dear ${userName},</p>
          
          <p>Thank you for agreeing to make a payment towards your debt.</p>
          
          <p>Payment Amount: <span class="amount">$${amount.toFixed(2)}</span></p>
          
          <p>${paymentMessage}</p>
          
          <div class="invoice-info">
            <p><strong>📎 Your invoice is attached to this email as a PDF file.</strong></p>
            <p>Please complete the payment within 7 days using the instructions provided in the attached invoice.</p>
          </div>
          
          <p>If you have any questions about this invoice or payment options, please don't hesitate to contact us.</p>
          
          <p>Best regards,<br>Debt Collection Services<br>Phone: (555) 123-4567<br>Email: billing@debtcollection.com</p>
        </div>
        <div class="footer">
          <p>This is an automated email. Please do not reply directly to this message.</p>
        </div>
      </div>
    </body>
    </html>
    `;
  }

  /**
   * Generate refused payment email HTML
   */
  generateRefusedEmail(userName: string, debt: number): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Payment Reminder</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #FF9800; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .debt { font-size: 20px; font-weight: bold; color: #FF9800; }
        .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Payment Reminder</h1>
        </div>
        <div class="content">
          <p>Dear ${userName},</p>
          
          <p>We noticed that you haven't agreed to make a payment during our recent call.</p>
          
          <p>Your current outstanding debt is: <span class="debt">$${debt.toFixed(2)}</span></p>
          
          <p>We understand that financial situations can be challenging. We're here to help you find a payment solution that works for you.</p>
          
          <p>Please feel free to call us again at your convenience to discuss payment options.</p>
          
          <p>Best regards,<br>Debt Collection Services</p>
        </div>
        <div class="footer">
          <p>This is an automated email. Please do not reply directly to this message.</p>
        </div>
      </div>
    </body>
    </html>
    `;
  }
}
