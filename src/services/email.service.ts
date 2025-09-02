import axios from 'axios';
import * as nodemailer from 'nodemailer';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { logger } from '../utils/logger';

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
  private carboneApiKey: string;
  private carboneTemplateId: string;
  private gmailUser: string;
  private gmailAppPassword: string;
  private carboneApiUrl = 'https://api.carbone.io';

  constructor() {
    this.carboneApiKey = process.env.CARBONE_API_KEY || '';
    this.carboneTemplateId = process.env.CARBONE_TEMPLATE_ID || '';
    this.gmailUser = process.env.GMAIL_USER || '';
    this.gmailAppPassword = process.env.GMAIL_APP_PASSWORD || '';
  }

  private createGmailTransporter() {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: this.gmailUser,
        pass: this.gmailAppPassword,
      },
    });
  }

  async sendGmailWithAttachment(
    recipientEmail: string,
    subject: string,
    body: string,
    fileBuffer: Buffer,
    filename: string,
    contentType = 'application/octet-stream'
  ): Promise<{ messageId: string; success: boolean }> {
    if (!this.gmailUser || !this.gmailAppPassword) {
      throw new Error('Gmail credentials not configured');
    }

    const transporter = this.createGmailTransporter();
    const mailOptions = {
      from: this.gmailUser,
      to: recipientEmail,
      subject,
      html: body,
      attachments: [
        {
          filename,
          content: fileBuffer,
          contentType,
        },
      ],
    };

    logger.info('Sending email via Gmail', {
      to: recipientEmail,
      subject,
      attachmentSize: fileBuffer.length,
    });

    const info = await transporter.sendMail(mailOptions);

    logger.info('Email sent successfully', {
      messageId: info.messageId,
      to: recipientEmail,
    });

    return {
      messageId: info.messageId,
      success: true,
    };
  }

  async sendInvoiceEmail(
    invoiceData: InvoiceData
  ): Promise<{ messageId: string; success: boolean; invoiceId: string }> {
    const invoice = await this.generateInvoicePDF(invoiceData);
    const pdfBuffer = Buffer.from(invoice.content, 'base64');

    const isFullPayment = invoiceData.debtAfter === 0;
    const emailHtml = this.generateInvoiceEmailHTML(
      invoiceData.userName,
      invoiceData.amount,
      invoiceData.debtAfter,
      isFullPayment,
      invoice.invoiceId
    );

    const subject = `Payment Invoice ${invoice.invoiceId} - $${invoiceData.amount.toFixed(2)}`;

    const result = await this.sendGmailWithAttachment(
      invoiceData.userEmail,
      subject,
      emailHtml,
      pdfBuffer,
      invoice.filename,
      'application/pdf'
    );

    return {
      messageId: result.messageId,
      success: result.success,
      invoiceId: invoice.invoiceId,
    };
  }

  private async generateInvoicePDF(
    data: InvoiceData
  ): Promise<{ filename: string; content: string; invoiceId: string }> {
    if (!this.carboneApiKey || !this.carboneTemplateId) {
      throw new Error('Carbone.io credentials not configured');
    }

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

    logger.info('Generating invoice with Carbone.io', {
      userId: data.userId,
      templateId: this.carboneTemplateId,
    });

    const renderResponse = await axios.post(
      `${this.carboneApiUrl}/render/${this.carboneTemplateId}`,
      { data: carboneData, convertTo: 'pdf' },
      {
        headers: {
          Authorization: `Bearer ${this.carboneApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    if (!renderResponse.data.success || renderResponse.data.error) {
      throw new Error(
        `Carbone API error: ${renderResponse.data.error || 'Unknown error'}`
      );
    }

    const renderId = renderResponse.data.data?.renderId;
    if (!renderId) {
      throw new Error('Carbone API did not return a renderId');
    }

    const downloadResponse = await axios.get(
      `${this.carboneApiUrl}/render/${renderId}`,
      {
        headers: { Authorization: `Bearer ${this.carboneApiKey}` },
        responseType: 'arraybuffer',
      }
    );

    const pdfContent = Buffer.from(downloadResponse.data).toString('base64');

    return {
      filename: `${invoiceId}.pdf`,
      content: pdfContent,
      invoiceId,
    };
  }

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
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; background: #fff; }
        .header { 
          background: linear-gradient(135deg, #f8bbd9 0%, #f48fb1 100%); 
          color: white; 
          padding: 30px 20px; 
          text-align: center; 
          border-radius: 8px 8px 0 0;
        }
        .header h1 { margin: 0; font-size: 28px; font-weight: 300; }
        .content { padding: 30px 20px; background: #fafafa; }
        .amount { 
          font-size: 32px; 
          font-weight: bold; 
          color: #e91e63; 
          text-align: center;
          margin: 20px 0;
          padding: 15px;
          background: #fce4ec;
          border-radius: 8px;
          border-left: 4px solid #e91e63;
        }
        .invoice-info { 
          background: #f3e5f5; 
          padding: 20px; 
          border-radius: 8px; 
          margin: 25px 0;
          border-left: 4px solid #ad1457;
        }
        .invoice-info strong { color: #ad1457; }
        .footer { 
          padding: 20px; 
          text-align: center; 
          font-size: 12px; 
          color: #666; 
          background: #f5f5f5;
          border-radius: 0 0 8px 8px;
        }
        .company-info { color: #ad1457; font-weight: 500; }
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
          
          <div class="amount">$${amount.toFixed(2)}</div>
          
          <p>${paymentMessage}</p>
          
          <div class="invoice-info">
            <p><strong>📎 Your invoice is attached to this email as a PDF file.</strong></p>
            <p>Please complete the payment within 7 days using the instructions provided in the attached invoice.</p>
          </div>
          
          <p>If you have any questions about this invoice or payment options, please don't hesitate to contact us.</p>
          
          <p class="company-info">
            Best regards,<br>
            Debt Collection Services<br>
            Phone: (555) 123-4567<br>
            Email: billing@debtcollection.com
          </p>
        </div>
        <div class="footer">
          <p>This is an automated email. Please do not reply directly to this message.</p>
        </div>
      </div>
    </body>
    </html>
    `;
  }

  generateRefusedEmail(userName: string, debt: number): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Payment Reminder</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 0 auto; background: #fff; }
        .header { 
          background: linear-gradient(135deg, #ffb3ba 0%, #ff9aa2 100%); 
          color: white; 
          padding: 30px 20px; 
          text-align: center; 
          border-radius: 8px 8px 0 0;
        }
        .content { padding: 30px 20px; background: #fafafa; }
        .debt { 
          font-size: 24px; 
          font-weight: bold; 
          color: #d32f2f; 
          text-align: center;
          margin: 20px 0;
          padding: 15px;
          background: #ffebee;
          border-radius: 8px;
          border-left: 4px solid #d32f2f;
        }
        .footer { 
          padding: 20px; 
          text-align: center; 
          font-size: 12px; 
          color: #666; 
          background: #f5f5f5;
          border-radius: 0 0 8px 8px;
        }
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
          
          <div class="debt">$${debt.toFixed(2)}</div>
          
          <p>We understand that financial situations can be challenging. We're here to help you find a payment solution that works for you.</p>
          
          <p>Please feel free to call us again at your convenience to discuss payment options.</p>
          
          <p style="color: #ad1457; font-weight: 500;">
            Best regards,<br>Debt Collection Services
          </p>
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
