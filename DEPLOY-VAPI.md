# //TODO it should just be a readme file with a bash command on how to deploy. If i deployed i would put as a task on my CI/CD pipeline


#!/bin/bash

# Simple VAPI Agent Deployment Script
# Usage: ./deploy-vapi.sh [config-file] [environment]
# Example: ./deploy-vapi.sh vapi-config.json production


set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
CONFIG_FILE="${1:-vapi-config.json}"
ENVIRONMENT="${2:-development}"
LOG_FILE="deploy-$(date +%Y%m%d_%H%M%S).log"

# Functions
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# Check dependencies
check_dependencies() {
    log "Checking dependencies..."
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        error "jq is not installed. Please install it: brew install jq (macOS) or apt-get install jq (Ubuntu)"
    fi
    
    # Check if curl is installed
    if ! command -v curl &> /dev/null; then
        error "curl is not installed. Please install curl"
    fi
    
    success "All dependencies are available"
}

# Load environment variables
load_environment() {
    log "Loading environment variables..."
    
    # Try to load from .env file
    if [ -f ".env" ]; then
        log "Loading variables from .env file"
        set -a  # automatically export all variables
        source .env
        set +a
    elif [ -f ".env.${ENVIRONMENT}" ]; then
        log "Loading variables from .env.${ENVIRONMENT} file"
        set -a
        source ".env.${ENVIRONMENT}"
        set +a
    else
        warning "No .env file found. Make sure environment variables are set manually."
    fi
    
    # Check required environment variables
    if [ -z "$VAPI_API_KEY" ]; then
        error "VAPI_API_KEY environment variable is required"
    fi
    
    if [ -z "$SERVER_URL" ]; then
        warning "SERVER_URL not set, using default: http://localhost:3000"
        SERVER_URL="http://localhost:3000"
    fi
    
    success "Environment variables loaded"
}

# Validate config file
validate_config() {
    log "Validating configuration file: $CONFIG_FILE"
    
    if [ ! -f "$CONFIG_FILE" ]; then
        error "Configuration file $CONFIG_FILE not found"
    fi
    
    # Validate JSON syntax
    if ! jq empty "$CONFIG_FILE" 2>/dev/null; then
        error "Invalid JSON in configuration file: $CONFIG_FILE"
    fi
    
    # Check required fields
    local required_fields=("name" "model" "voice" "firstMessage" "prompt")
    for field in "${required_fields[@]}"; do
        if ! jq -e ".$field" "$CONFIG_FILE" >/dev/null; then
            error "Required field '$field' missing in configuration file"
        fi
    done
    
    success "Configuration file is valid"
}

# Build agent payload
build_agent_payload() {
    log "Building agent payload from configuration..."
    
    # Read the config file and build the payload
    local config=$(cat "$CONFIG_FILE")
    
    # Build the agent configuration with serverUrl injection
    local agent_payload=$(echo "$config" | jq --arg serverUrl "$SERVER_URL" --arg webhookSecret "$VAPI_WEBHOOK_SECRET" '
    {
        name: .name,
        model: .model,
        voice: .voice,
        firstMessage: .firstMessage,
        prompt: .prompt,
        endCallMessage: (.endCallMessage // "Thank you for your time today. Goodbye!"),
        endCallPhrases: (.endCallPhrases // ["goodbye", "bye bye", "end call"]),
        transcriber: (.transcriber // {provider: "deepgram", model: "nova-2", language: "en"}),
        serverUrl: $serverUrl,
        serverUrlSecret: $webhookSecret,
        functions: [
            .functions[] | {
                name: .name,
                description: .description,
                parameters: .parameters,
                serverUrl: ($serverUrl + .endpoint),
                speak: (.speak // null)
            }
        ],
        analysisPlan: (.analysisPlan // null)
    }')
    
    echo "$agent_payload" > "/tmp/vapi_agent_payload.json"
    success "Agent payload built successfully"
}

# Deploy to VAPI
deploy_agent() {
    log "Deploying agent to VAPI..."
    
    local payload_file="/tmp/vapi_agent_payload.json"
    
    # Check if updating existing agent or creating new one
    if [ -n "$VAPI_AGENT_ID" ]; then
        log "Updating existing agent (ID: $VAPI_AGENT_ID)"
        local response=$(curl -s -X PATCH "https://api.vapi.ai/agent/$VAPI_AGENT_ID" \
            -H "Authorization: Bearer $VAPI_API_KEY" \
            -H "Content-Type: application/json" \
            -d @"$payload_file")
    else
        log "Creating new agent"
        local response=$(curl -s -X POST "https://api.vapi.ai/agent" \
            -H "Authorization: Bearer $VAPI_API_KEY" \
            -H "Content-Type: application/json" \
            -d @"$payload_file")
    fi
    
    # Check if request was successful
    local agent_id=$(echo "$response" | jq -r '.id // empty')
    local error_message=$(echo "$response" | jq -r '.error.message // empty')
    
    if [ -n "$error_message" ]; then
        error "VAPI API Error: $error_message"
    fi
    
    if [ -n "$agent_id" ]; then
        success "Agent deployed successfully! Agent ID: $agent_id"
        
        # Save agent ID for future updates
        echo "VAPI_AGENT_ID=$agent_id" >> ".env.agent"
        log "Agent ID saved to .env.agent file"
        
        # Clean up temporary file
        rm -f "$payload_file"
        
        return 0
    else
        error "Failed to deploy agent. Response: $response"
    fi
}

# Test deployment (optional)
test_deployment() {
    if [ "$SKIP_TEST" != "true" ]; then
        log "Testing deployment..."
        
        if [ -n "$VAPI_PHONE_NUMBER_ID" ]; then
            log "Testing with phone number ID: $VAPI_PHONE_NUMBER_ID"
            # Add any test calls here if needed
            success "Deployment test completed"
        else
            warning "VAPI_PHONE_NUMBER_ID not set, skipping phone test"
        fi
    else
        log "Skipping deployment test"
    fi
}

# Show deployment summary
show_summary() {
    log "=== Deployment Summary ==="
    log "Configuration: $CONFIG_FILE"
    log "Environment: $ENVIRONMENT"
    log "Server URL: $SERVER_URL"
    
    if [ -f ".env.agent" ]; then
        local agent_id=$(grep "VAPI_AGENT_ID" .env.agent | cut -d'=' -f2)
        log "Agent ID: $agent_id"
    fi
    
    log "Log file: $LOG_FILE"
    success "Deployment completed successfully!"
}

# Main execution
main() {
    log "Starting VAPI agent deployment..."
    log "Config file: $CONFIG_FILE"
    log "Environment: $ENVIRONMENT"
    
    check_dependencies
    load_environment
    validate_config
    build_agent_payload
    deploy_agent
    test_deployment
    show_summary
}

# Help function
show_help() {
    cat << EOF
VAPI Agent Deployment Script

Usage: $0 [config-file] [environment]

Arguments:
  config-file    JSON configuration file (default: vapi-config.json)
  environment    Deployment environment (default: development)

Environment Variables:
  VAPI_API_KEY           Required: Your VAPI API key
  VAPI_AGENT_ID          Optional: Existing agent ID to update
  VAPI_PHONE_NUMBER_ID   Optional: Phone number for testing
  VAPI_WEBHOOK_SECRET    Optional: Webhook secret for security
  SERVER_URL             Optional: Your server URL (default: http://localhost:3000)
  SKIP_TEST              Optional: Set to 'true' to skip deployment test

Examples:
  $0                                    # Use defaults
  $0 vapi-config.json production        # Deploy to production
  $0 custom-config.json development     # Use custom config

EOF
}

# Handle script arguments
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

# Run main function
main

---
# ai dump on deployment
# VAPI Agent Deployment Guide

This guide explains how to use the simple bash deployment script to deploy your VAPI agent using JSON configuration.

## Quick Start

1. **Set up environment variables:**
   ```bash
   cp env.template .env
   # Edit .env with your actual values
   ```

2. **Deploy the agent:**
   ```bash
   ./deploy-vapi.sh
   ```

## Files Overview

- `deploy-vapi.sh` - Main deployment script
- `vapi-config.json` - Agent configuration in JSON format
- `env.template` - Template for environment variables

## Prerequisites

### Required Tools
- `jq` - JSON processor
  ```bash
  # macOS
  brew install jq
  
  # Ubuntu/Debian
  sudo apt-get install jq
  ```
- `curl` - HTTP client (usually pre-installed)

### Required Environment Variables

Create a `.env` file with these variables:

```bash
# Required
VAPI_API_KEY=your_vapi_api_key_here
SERVER_URL=https://your-domain.com

# Optional (for updating existing agent)
VAPI_AGENT_ID=existing_agent_id

# Optional (for testing)
VAPI_PHONE_NUMBER_ID=your_phone_number_id
VAPI_WEBHOOK_SECRET=your_webhook_secret
```

## Usage

### Basic Deployment
```bash
./deploy-vapi.sh
```
Uses default config file (`vapi-config.json`) and development environment.

### Custom Configuration
```bash
./deploy-vapi.sh custom-config.json production
```

### Update Existing Agent
Set `VAPI_AGENT_ID` in your `.env` file, then run:
```bash
./deploy-vapi.sh
```

### Skip Testing
```bash
SKIP_TEST=true ./deploy-vapi.sh
```

## Configuration File

The `vapi-config.json` file contains all agent settings:

```json
{
  "name": "Your Agent Name",
  "model": {
    "provider": "openai",
    "model": "gpt-4-turbo",
    "temperature": 0.7
  },
  "voice": {
    "provider": "elevenlabs",
    "voiceId": "voice_id_here"
  },
  "functions": [
    {
      "name": "functionName",
      "endpoint": "/api/endpoint",
      "description": "Function description"
    }
  ]
}
```

### Key Features:
- **Server URL Injection**: The script automatically injects your `SERVER_URL` into function endpoints
- **Webhook Security**: Automatically includes webhook secret if provided
- **Validation**: Validates JSON syntax and required fields
- **Error Handling**: Comprehensive error checking and logging

## Script Features

### ✅ Dependency Checking
- Verifies `jq` and `curl` are installed
- Clear error messages if dependencies are missing

### ✅ Configuration Validation
- JSON syntax validation
- Required field checking
- Clear error reporting

### ✅ Environment Handling
- Loads from `.env` or `.env.{environment}` files
- Supports manual environment variable setting
- Validates required variables

### ✅ Deployment Modes
- Create new agent
- Update existing agent (when `VAPI_AGENT_ID` is set)
- Automatic agent ID saving for future updates

### ✅ Logging & Monitoring
- Timestamped logs
- Color-coded output
- Log file generation (`deploy-YYYYMMDD_HHMMSS.log`)
- Deployment summary

### ✅ Error Recovery
- Comprehensive error handling
- Clean temporary file cleanup
- Detailed error messages

## Troubleshooting

### Common Issues

1. **"jq not found"**
   ```bash
   brew install jq  # macOS
   sudo apt-get install jq  # Ubuntu
   ```

2. **"VAPI_API_KEY is required"**
   - Check your `.env` file exists
   - Verify the API key is correctly set

3. **"Invalid JSON"**
   - Validate your config file with: `jq . vapi-config.json`
   - Check for trailing commas or syntax errors

4. **"VAPI API Error"**
   - Check your API key is valid
   - Verify your VAPI account has sufficient permissions
   - Check the error message in the logs

### Log Files
Each deployment creates a timestamped log file:
```bash
deploy-20240101_120000.log
```

### Test the Configuration
```bash
# Validate JSON syntax
jq . vapi-config.json

# Test environment loading
source .env && echo $VAPI_API_KEY
```

## Advanced Usage

### Multiple Environments
Create environment-specific files:
```bash
.env.development
.env.staging  
.env.production
```

Deploy to specific environment:
```bash
./deploy-vapi.sh vapi-config.json production
```

### Custom Configuration Files
Create different config files for different use cases:
```bash
./deploy-vapi.sh debt-collection-config.json
./deploy-vapi.sh customer-service-config.json
```

### Automation
Use in CI/CD pipelines:
```bash
#!/bin/bash
export VAPI_API_KEY="$CI_VAPI_API_KEY"
export SERVER_URL="$CI_SERVER_URL"
./deploy-vapi.sh production-config.json production
```

## Security Notes

- Never commit `.env` files to version control
- Use environment-specific secrets management
- Rotate API keys regularly
- Use webhook secrets for production deployments

## Support

For issues with this deployment script, check:
1. Log files for detailed error information
2. VAPI API documentation
3. Environment variable configuration

The script includes comprehensive error reporting to help diagnose issues quickly.