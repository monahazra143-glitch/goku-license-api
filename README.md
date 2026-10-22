# goku-license-api

GOKU ऐप का लाइसेंस सर्वर। **एक key = एक फ़ोन**, और आप खुद किसी की key ब्लॉक कर सकते हो।
Licence server for the GOKU app: **one key = one device**, with remote block / unblock / device reset.

**Stack:** Vercel (serverless API + admin page) · Supabase (Postgres database) · कोई paid सेवा नहीं / no paid service needed.

---

## यह कैसे चलता है / How it works

```
GOKU ऐप ──(key + device id)──▶ Vercel API ──▶ Supabase (licenses टेबल)
                                   ▲
Admin पेज (/admin.html) ───────────┘
```

| चरण | क्या होता है |
|---|---|
| Activate | key पहली बार जिस फ़ोन से आती है, उसी से बंध जाती है। दूसरा फ़ोन = मना। |
| Check | ऐप हर 6 घंटे में पूछता है। Block / expire हुई key पर Pro बंद। |
| Offline | इंटरनेट बिना Pro 3 दिन चलता है, फिर जाँच ज़रूरी। |
| Expiry | दिनों की गिनती सर्वर की घड़ी से होती है, फ़ोन की तारीख़ बदलने से कुछ नहीं बढ़ता। |

**Key प्लान:** Lifetime (Pro Max) · 7 दिन · 15 दिन · 30 दिन।
**Key फ़ॉर्मेट:** `GOKU-XXXX-XXXX-XXXX`

---

## फ़ोल्डर / Files

```
api/index.js        सारा सर्वर कोड (activate, check, admin)
public/admin.html   Admin पेज
package.json        प्रोजेक्ट की जानकारी
```

## API

सब कुछ `POST /api?op=...` पर, JSON body के साथ।

| op | body | काम |
|---|---|---|
| `activate` | `{ key, device }` | key को फ़ोन से बाँधो (पहली बार) |
| `check` | `{ key, device }` | key अब भी चालू है? |
| `admin` | `{ action, key?, q?, note? }` + header `x-admin-password` | admin काम |

Admin `action`: `search` · `block` · `unblock` · `reset` (फ़ोन बदला) · `note`

---

## सेटअप / Setup

### 1. Supabase
1. नया project बनाओ, SQL Editor में चलाओ:
   ```sql
   create table licenses (
     key text primary key,
     serial int,
     type text,
     days int,
     status text not null default 'active',
     device_id text,
     activated_at timestamptz,
     expires_at timestamptz,
     note text
   );
   alter table licenses enable row level security;
   create index licenses_device_idx on licenses (device_id);
   create index licenses_serial_idx on licenses (serial);
   ```
2. Table Editor → `licenses` → Insert → **Import data from CSV** → `goku_keys_v3.csv`
3. Project Settings → API Keys से **Project URL** और **Secret key** (`sb_secret_...`) लो।

### 2. Vercel
1. vercel.com → **Add New → Project** → यह repo Import करो।
2. **Environment Variables** डालो:

   | नाम | मान |
   |---|---|
   | `SUPABASE_URL` | `https://<आपका-project>.supabase.co` |
   | `SUPABASE_SERVICE_KEY` | Supabase की **secret** key |
   | `ADMIN_PASSWORD` | अपना मज़बूत पासवर्ड (कम से कम 16 अक्षर) |

3. **Deploy**। आपको मिलेगा: `https://<नाम>.vercel.app`

### 3. ऐप
`LicenseManager.java` में `SERVER` में Vercel का पता डालो और नया APK बनाओ।

### 4. Admin
`https://<नाम>.vercel.app/admin.html` → पासवर्ड डालो → key / device / नाम से खोजो → **Block**, **Unblock**, **Reset device**, **Note**।

---

## सुरक्षा के नियम / Security

- **Secret key कभी GitHub, चैट या ऐप में मत डालो।** सिर्फ़ Vercel के Environment Variables में।
- Secret key लीक हो जाए तो Supabase में तुरंत हटाकर नई बनाओ, फिर Vercel में बदलकर **Redeploy** करो।
- Supabase टेबल पर **RLS चालू** रखो, बिना secret key कोई टेबल नहीं पढ़ सकता।
- `ADMIN_PASSWORD` लंबा रखो। Admin पेज पर बहुत बार ग़लत पासवर्ड आज़माने की कोई सीमा नहीं है, इसलिए छोटा पासवर्ड ख़तरनाक है।
- `goku_keys_v3.csv` (असली keys की सूची) कभी इस repo में मत डालो।

## आम दिक़्क़तें / Troubleshooting

| दिक़्क़त | हल |
|---|---|
| Admin पेज पर "wrong password" | `ADMIN_PASSWORD` वही है जो Vercel में डाला? बदलने के बाद Redeploy करो। |
| "Server error, try again" | Vercel → Logs देखो। आम वजह: `SUPABASE_URL` या secret key ग़लत। |
| Supabase रुका हुआ है | Free project हफ़्ते भर कोई इस्तेमाल न हो तो रुकता है। Dashboard में **Restore** दबाओ। |
| यूज़र ने फ़ोन बदला | Admin पेज → उसकी key → **Reset device**। बची हुई expiry वही रहती है। |
| यूज़र का एक्सेस रोकना है | Admin पेज → **Block**। ऐप अगली जाँच (≤ 6 घंटे) पर Pro बंद कर देगा। |
