#!/bin/bash
# Import Azure environment on new PC

echo "🚀 Setting up Azure environment on new PC..."

# Check prerequisites
command -v az >/dev/null 2>&1 || { echo "❌ Azure CLI not installed. Install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"; exit 1; }
command -v azd >/dev/null 2>&1 || { echo "❌ Azure Developer CLI not installed. Install from: https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/install-azd"; exit 1; }

# Login to Azure
echo "📝 Logging into Azure..."
az login
azd auth login

# Set subscription
echo "🔧 Setting Azure subscription..."
az account set --subscription "c84cf1ff-052d-4e7c-aa21-d78105e638ee"

# Create environment
ENV_NAME="ssg"
echo "🌍 Creating azd environment: $ENV_NAME"
azd env new $ENV_NAME || echo "Environment already exists"
azd env set $ENV_NAME

# Import values
if [ -f "azure-env-encrypted.bin" ]; then
    echo "🔐 Found encrypted environment file. Decrypting..."
    openssl enc -d -aes-256-cbc -pbkdf2 -in azure-env-encrypted.bin -out azure-env-full.txt
    cat azure-env-full.txt | azd env set-values
    rm azure-env-full.txt  # Clean up decrypted file
elif [ -f "azure-env-full.txt" ]; then
    echo "📥 Importing environment values..."
    cat azure-env-full.txt | azd env set-values
elif [ -f "azure-env-safe.txt" ] && [ -f "azure-env-secrets.txt" ]; then
    echo "📥 Importing safe values..."
    cat azure-env-safe.txt | azd env set-values
    echo ""
    echo "⚠️  IMPORTANT: You need to manually add secrets!"
    echo "   Edit azure-env-secrets.txt and replace <REPLACE_ME> values"
    echo "   Then run: cat azure-env-secrets.txt | azd env set-values"
else
    echo "❌ No environment files found!"
    echo "   You need one of:"
    echo "   - azure-env-encrypted.bin (encrypted)"
    echo "   - azure-env-full.txt (full export)"
    echo "   - azure-env-safe.txt + azure-env-secrets.txt"
    exit 1
fi

# Verify
echo ""
echo "✅ Environment imported! Verifying..."
echo ""
echo "Current environment:"
azd env list

echo ""
echo "Key values (first 5):"
azd env get-values | head -5

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. cd backend && cp .env.example .env"
echo "2. cd frontend && cp sample.env .env" 
echo "3. Test locally: cd backend && uvicorn main:app --reload"
echo "4. Deploy: azd up"