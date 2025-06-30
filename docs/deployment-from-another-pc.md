# Návod pro nasazení z jiného PC

## 🚀 Co potřebujete pro pokračování na jiném počítači

### 1. **Prerekvizity - Software**
```bash
# Nainstalujte tyto nástroje:
- Git
- Azure CLI: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
- Azure Developer CLI (azd): https://learn.microsoft.com/en-us/azure/developer/azure-developer-cli/install-azd
- Node.js 18+ a npm
- Python 3.10+ a uv (Python package manager)
- Docker (optional, pro local development)
```

### 2. **Clone repository**
```bash
git clone <your-repo-url>
cd meeting-stt
git checkout stable-before-azure-ad  # nebo vaše branch
```

### 3. **Azure Authentication**
```bash
# Login do Azure
az login
azd auth login

# Nastavte správnou subscription
az account set --subscription "c84cf1ff-052d-4e7c-aa21-d78105e638ee"
```

### 4. **Azure Developer CLI Environment**

#### Option A: Import existující environment (DOPORUČENO)
```bash
# Na původním PC exportujte environment
azd env list  # zobrazí dostupné environments
azd env set ssg  # nebo název vašeho env
azd env get-values > azure-env-values.txt

# Zkopírujte tento soubor na nový PC a pak:
azd env new ssg  # vytvoří nový environment
azd env set ssg
cat azure-env-values.txt | azd env set-values  # naimportuje všechny hodnoty
```

#### Option B: Manuální setup
```bash
# Vytvořte nový environment
azd env new ssg
azd env set ssg

# Nastavte klíčové hodnoty
azd env set AZURE_ENV_NAME ssg
azd env set AZURE_LOCATION westeurope
azd env set AZURE_SUBSCRIPTION_ID c84cf1ff-052d-4e7c-aa21-d78105e638ee
```

### 5. **Kritické Environment Variables**

Tyto hodnoty MUSÍTE přenést z původního PC nebo získat z Azure Portal:

```bash
# Storage Account credentials (pro historii)
AZURE_STORAGE_ACCOUNT_NAME=stmw3nepyclf5lk
AZURE_STORAGE_ACCOUNT_KEY=<získat z Azure Portal>

# Speech Service
AZURE_SPEECH_KEY=<získat z Azure Portal>
AZURE_SPEECH_ENDPOINT=https://cog-speech-mw3nepyclf5lk.cognitiveservices.azure.com/
AZURE_SPEECH_REGION=westeurope

# Další důležité
AZURE_RESOURCE_GROUP=rg-ssg
SERVICE_BACKEND_URI=https://backend.politerock-fc734aeb.westeurope.azurecontainerapps.io
```

### 6. **Local Development Setup**

```bash
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
# nebo
.venv\Scripts\activate  # Windows

uv sync
cp .env.example .env  # vytvořte .env soubor
# Editujte .env a doplňte credentials

# Frontend
cd ../frontend
npm install
cp sample.env .env
# Editujte .env a nastavte VITE_BASE_URL
```

### 7. **Získání Azure Credentials**

#### Pro Storage Account Key:
1. Azure Portal → Storage Accounts → stmw3nepyclf5lk
2. Access keys → Show keys → Copy key1

#### Pro Speech Service Key:
1. Azure Portal → Cognitive Services → cog-speech-mw3nepyclf5lk
2. Keys and Endpoint → Copy KEY 1

#### Nebo použijte Azure CLI:
```bash
# Storage Account Key
az storage account keys list \
  --account-name stmw3nepyclf5lk \
  --resource-group rg-ssg \
  --query "[0].value" -o tsv

# Speech Service Key
az cognitiveservices account keys list \
  --name cog-speech-mw3nepyclf5lk \
  --resource-group rg-ssg \
  --query "key1" -o tsv
```

### 8. **Deployment**

```bash
# Zkontrolujte environment
azd env get-values

# Deploy
azd up --no-prompt

# Nebo jednotlivé části
azd deploy backend
azd deploy frontend
```

### 9. **Bezpečný přenos credentials**

#### DOPORUČENÝ POSTUP:
1. **Použijte password manager** (1Password, Bitwarden, etc.)
2. **Encrypted file transfer** (gpg, age, 7zip s heslem)
3. **Azure Key Vault** (nejlepší pro týmy)

#### NIKDY:
- ❌ Neposílejte credentials emailem
- ❌ Necommitujte .env soubory
- ❌ Nepoužívejte plaintext messenger

### 10. **Troubleshooting**

```bash
# Ověřte Azure login
az account show

# Zkontrolujte azd environment
azd env list
azd env get-values

# Test backend connection
curl https://backend.politerock-fc734aeb.westeurope.azurecontainerapps.io/docs

# Zkontrolujte resources
az resource list --resource-group rg-ssg --output table
```

## 📝 Checklist pro nový PC

- [ ] Nainstalován Azure CLI a azd
- [ ] Git repository naklonován
- [ ] Azure login úspěšný
- [ ] azd environment vytvořen/importován
- [ ] Storage Account Key nastaven
- [ ] Speech Service Key nastaven
- [ ] Backend .env soubor vytvořen
- [ ] Frontend .env soubor vytvořen
- [ ] Local test úspěšný
- [ ] Deployment úspěšný

## 🔐 Security Notes

1. **Credentials rotation**: Zvažte rotaci klíčů po přenosu
2. **Access control**: Ověřte že máte správné Azure role
3. **Environment isolation**: Používejte různé environments pro dev/staging/prod

## 🚨 Důležité kontakty

- Azure Subscription ID: `c84cf1ff-052d-4e7c-aa21-d78105e638ee`
- Resource Group: `rg-ssg`
- Backend URL: `https://backend.politerock-fc734aeb.westeurope.azurecontainerapps.io`

---

Pro automatizaci tohoto procesu zvažte vytvoření setup scriptu nebo použití Azure Key Vault pro centrální správu credentials.