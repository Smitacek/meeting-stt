#!/bin/bash
# Export Azure environment values safely (masks sensitive data)

echo "Exporting Azure environment values..."

# Get all values
azd env get-values > azure-env-full.txt

# Create safe version without secrets
azd env get-values | grep -v -E "KEY|SECRET|PASSWORD|TOKEN" > azure-env-safe.txt

# Create secrets template
echo "# Add these values from Azure Portal or original PC:" > azure-env-secrets.txt
echo "" >> azure-env-secrets.txt
azd env get-values | grep -E "KEY|SECRET|PASSWORD|TOKEN" | sed 's/=.*/=<REPLACE_ME>/' >> azure-env-secrets.txt

echo "✅ Created files:"
echo "  - azure-env-full.txt (SENSITIVE - contains secrets)"
echo "  - azure-env-safe.txt (SAFE - no secrets)"
echo "  - azure-env-secrets.txt (TEMPLATE - for manual filling)"

echo ""
echo "⚠️  IMPORTANT:"
echo "  - azure-env-full.txt contains SECRETS - handle with care!"
echo "  - Use encrypted transfer for azure-env-full.txt"
echo "  - Or manually fill azure-env-secrets.txt on new PC"

# Optional: encrypt the full file
read -p "Encrypt azure-env-full.txt with password? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]
then
    # Using openssl for cross-platform compatibility
    openssl enc -aes-256-cbc -salt -pbkdf2 -in azure-env-full.txt -out azure-env-encrypted.bin
    rm azure-env-full.txt
    echo "✅ Encrypted to azure-env-encrypted.bin"
    echo "   Decrypt with: openssl enc -d -aes-256-cbc -pbkdf2 -in azure-env-encrypted.bin -out azure-env-full.txt"
fi