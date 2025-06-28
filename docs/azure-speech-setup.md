# Azure Speech Service Setup

## Environment Variables Required

Pro správné fungování real-time transkripce je potřeba nastavit následující environment variables v Azure Container Apps:

### Backend Container Environment Variables:

```bash
# Azure Speech Service credentials
AZURE_SPEECH_KEY=<your-speech-service-key>
AZURE_SPEECH_ENDPOINT=https://westeurope.api.cognitive.microsoft.com/
AZURE_SPEECH_REGION=westeurope

# Or use Azure Identity (Managed Identity)
AZURE_CLIENT_ID=<managed-identity-client-id>
AZURE_TENANT_ID=<tenant-id>
AZURE_CLIENT_SECRET=<client-secret>
```

## Nastavení v Azure Portal:

1. **Azure Portal** → Container Apps → `backend` container
2. **Settings** → **Environment variables**
3. Přidat výše uvedené proměnné
4. **Save** a **Restart** container

## Získání Azure Speech Service Key:

1. **Azure Portal** → Create Resource → "Speech"
2. Vytvořit Speech Service resource v regionu `West Europe`
3. **Keys and Endpoint** → zkopírovat `KEY 1` nebo `KEY 2`
4. Zkopírovat také `Endpoint`

## Alternativa - Managed Identity:

1. Povolit System Assigned Managed Identity pro Container App
2. Přiřadit roli `Cognitive Services User` k Managed Identity
3. Nemusíte pak používat `AZURE_SPEECH_KEY`

## Ověření konfigurace:

Po nastavení zkontrolujte endpoint:
```bash
curl https://backend.gentlesky-600a0c99.westeurope.azurecontainerapps.io/live/token
```

Odpověď by měla obsahovat:
```json
{
  "success": true,
  "token": "...",
  "region": "westeurope",
  "service": "Azure Speech Service"
}
```

Pokud vidíte `"mock_mode": true`, znamená to, že credentials nejsou správně nastavené.