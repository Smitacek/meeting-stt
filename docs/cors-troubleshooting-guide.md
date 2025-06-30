# CORS Troubleshooting Quick Reference

## 🚨 When You See CORS Errors

### **Status 500 with "Origin not allowed" - WITHOUT auth headers**
❌ **Duplicate CORS policies** - Both API Management AND Backend have CORS  
✅ **Fix:** Remove CORS from one layer (recommend: keep backend, remove API Management)

### **Status 500 with "Origin not allowed" - WITH auth headers**
❌ **API Management not forwarding auth headers properly**  
✅ **Fix:** Add conditional header forwarding in API Management policy  
✅ **Symptoms:** Works with curl but fails in browser when auth headers present

### **Status 404 with CORS error**  
❌ **Missing API operation** in API Management  
✅ **Fix:** Add operation to `api-management.bicep` with correct URL template

### **Works with curl, fails in browser**
❌ **CORS policy order wrong** in API Management  
✅ **Fix:** Move `<cors>` to be FIRST policy in `<inbound>` section

### **500 Internal Server Error with HTML page**
❌ **Invalid C# expression** in API Management policy  
✅ **Fix:** Simplify or remove complex header manipulations

## ⚡ Quick Fix Commands

```bash
# Test endpoint directly (should always work)
curl https://api-endpoint

# Test with Origin header (may fail if CORS broken)
curl -H "Origin: https://your-domain.com" https://api-endpoint

# Check for duplicate CORS headers
curl -v -H "Origin: https://your-domain.com" https://api-endpoint | grep "Access-Control"
```

## 🔧 Standard Working Configuration

### Backend (FastAPI)
```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### API Management (NO CORS, with auth forwarding)
```xml
<policies>
  <inbound>
    <set-backend-service backend-id="backend-containerapp" />
    <!-- Forward auth header if present -->
    <choose>
      <when condition="@(context.Request.Headers.ContainsKey("X-MS-CLIENT-PRINCIPAL"))">
        <set-header name="X-MS-CLIENT-PRINCIPAL" exists-action="override">
          <value>@(context.Request.Headers["X-MS-CLIENT-PRINCIPAL"].First())</value>
        </set-header>
      </when>
    </choose>
  </inbound>
</policies>
```

## 📋 Debug Checklist

1. ✅ Only ONE layer handles CORS (backend OR API Management, not both)
2. ✅ If using API Management CORS, it's the FIRST policy in `<inbound>`
3. ✅ Auth headers forwarded conditionally (not with complex expressions)
4. ✅ All required API operations defined in API Management
5. ✅ Test with browser dev tools AND curl
6. ✅ Test both with and without auth headers:
   ```bash
   # Without auth (should work)
   curl https://api-endpoint
   # With auth (may fail if forwarding broken)
   curl -H "X-MS-CLIENT-PRINCIPAL: token" https://api-endpoint
   ```

## 🎯 Remember

**CORS is a browser security feature** - curl requests always work regardless of CORS configuration. If curl works but browser fails, it's always a CORS configuration issue.