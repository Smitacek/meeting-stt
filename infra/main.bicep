targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Name of the environment that can be used as part of naming resource convention')
param environmentName string

@minLength(1)
@description('Primary location for all resources')
@allowed([
  'northcentralusstage'
  'westus2'
  'northeurope'
  'eastus'
  'eastasia'
  'northcentralus'
  'germanywestcentral'
  'polandcentral'
  'italynorth'
  'switzerlandnorth'
  'swedencentral'
  'norwayeast'
  'japaneast'
  'australiaeast'
  'westcentralus'
  'westeurope'
]) // limit to regions where Dynamic sessions are available as of 2024-11-29
param location string

param srcExists bool
@secure()
param srcDefinition object = {
  repositoryUrl: 'https://example.com/repo.git'
  branch: 'main'
  frontendArtifactLocation: 'dist'
  settings: [
    {
      name: 'setting1'
      value: 'value1'
    }
  ]
}

@description('Id of the user or app to assign application roles')
param principalId string

@description('Prefix for OpenAI custom subdomain names')
param openaiPrefix string = 'meetingstt'

@description('Location for Static Web Apps')
param frontendLocation string = 'westeurope'

// Tags that should be applied to all resources.
// 
// Note that 'azd-service-name' tags should be applied separately to service host resources.
// Example usage:
//   tags: union(tags, { 'azd-service-name': <service name in azure.yaml> })
var tags = {
  'azd-env-name': environmentName
}

var abbrs = loadJsonContent('./abbreviations.json')
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
// Use parameterized prefix instead of hardcoded value
var prefix = '${openaiPrefix}-${resourceToken}'

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module monitoring './shared/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    tags: tags
    logAnalyticsName: '${abbrs.operationalInsightsWorkspaces}${resourceToken}'
    applicationInsightsName: '${abbrs.insightsComponents}${resourceToken}'
  }
  scope: rg
}

module dashboard './shared/dashboard-web.bicep' = {
  name: 'dashboard'
  params: {
    name: '${abbrs.portalDashboards}${resourceToken}'
    applicationInsightsName: monitoring.outputs.applicationInsightsName
    location: location
    tags: tags
  }
  scope: rg
}

module registry './shared/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    tags: tags
    name: '${abbrs.containerRegistryRegistries}${resourceToken}'
  }
  scope: rg
}

module keyVault './shared/keyvault.bicep' = {
  name: 'keyvault'
  params: {
    location: location
    tags: tags
    name: '${abbrs.keyVaultVaults}${resourceToken}'
    principalId: principalId
  }
  scope: rg
}

// Add network module before appsEnv
module network './shared/netwk.bicep' = {
  name: 'network'
  params: {
    name: '${abbrs.networkVirtualNetworks}${resourceToken}'
    location: location
    tags: tags
  }
  scope: rg
}

module appsEnv './shared/apps-env.bicep' = {
  name: 'apps-env'
  params: {
    name: '${abbrs.appManagedEnvironments}${resourceToken}'
    location: location
    tags: tags
    applicationInsightsName: monitoring.outputs.applicationInsightsName
    logAnalyticsWorkspaceName: monitoring.outputs.logAnalyticsWorkspaceName
    // Pass the ACA subnet ID from the network module
    infrastructureSubnetId: network.outputs.acaSubnetId
    // managedResourceGroupName: '${rg.name}-apps-env-mng'
  }
  scope: rg
}

module backend './app/backend.bicep' = {
  name: 'backend'
  params: {
    name: 'backend'
    location: location
    tags: tags
    identityName: '${abbrs.managedIdentityUserAssignedIdentities}backend-${resourceToken}'
    applicationInsightsName: monitoring.outputs.applicationInsightsName
    containerAppsEnvironmentName: appsEnv.outputs.name
    containerRegistryName: registry.outputs.name
    exists: srcExists
    appDefinition: srcDefinition
    userPrincipalId: principalId
    customSubDomainName: '${prefix}-${resourceToken}'
    storageName: '${abbrs.storageStorageAccounts}${resourceToken}'
    vnetId: network.outputs.vnetId
    acaSubnetId: network.outputs.acaSubnetId
    defaultSubnetId: network.outputs.defaultSubnetId
    speechServiceName: '${abbrs.cognitiveServicesAccounts}speech-${resourceToken}'
    azureOpenaiResourceName: '${abbrs.cognitiveServicesAccounts}openai-${resourceToken}'
    azureOpenaiDeploymentName: 'chat'
    azureOpenaiTranscribeResourceName: '${abbrs.cognitiveServicesAccounts}transcribe-${resourceToken}'
    azureOpenaiTranscribeDeploymentName: 'transcribe'
  }
  scope: rg
  dependsOn: [
    network
    appsEnv
  ]
}

// Add frontend deployment module
module frontend './app/frontend.bicep' = {
  name: 'frontend'
  params: {
    name: '${abbrs.webStaticSites}${resourceToken}'
    location: frontendLocation
    tags: tags
    repositoryUrl: srcDefinition.repositoryUrl
    branch: srcDefinition.branch
    appArtifactLocation: srcDefinition.frontendArtifactLocation
  }
  scope: rg
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_KEY_VAULT_NAME string = keyVault.outputs.name
output AZURE_KEY_VAULT_ENDPOINT string = keyVault.outputs.endpoint
output AZURE_OPENAI_ENDPOINT string = backend.outputs.azure_endpoint
output SERVICE_BACKEND_URI string = backend.outputs.uri
output STATIC_SITE_ENDPOINT string = frontend.outputs.staticSiteEndpoint
output AZURE_RESOURCE_GROUP string = rg.name

output AZURE_STORAGE_ACCOUNT_ENDPOINT string = backend.outputs.storageAccountEndpoint
output AZURE_STORAGE_ACCOUNT_ID string = backend.outputs.storageAccountId
output UAMI_RESOURCE_ID string = backend.outputs.userAssignedIdentityId
output AZURE_SPEECH_ENDPOINT string = backend.outputs.speechServiceEndpoint
output AZURE_SPEECH_REGION string = backend.outputs.speechServiceRegion
output AZURE_SPEECH_KEY string = backend.outputs.speechServiceKey

output MODEL_NAME string = backend.outputs.azureOpenaiDeploymentName
output AZURE_OPENAI_ENDPOINT_TRANSCRIBE string = backend.outputs.azureOpenaiTranscribeEndpoint
output AZURE_OPENAI_DEPLOYMENT_NAME_TRANSCRIBE string = backend.outputs.azureOpenaiTranscribeDeploymentName

output AZURE_STORAGE_ACCOUNT_KEY string = backend.outputs.storageAccountKey
output AZURE_STORAGE_ACCOUNT_NAME string = backend.outputs.storageAccountName
