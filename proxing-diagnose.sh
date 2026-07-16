#!/usr/bin/env bash
set -u

DOMAIN="https://proxing.online"
API_LOCAL="http://127.0.0.1:4000"

GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
BLUE="\033[0;34m"
NC="\033[0m"

ok()    { echo -e "${GREEN}✅ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
fail()  { echo -e "${RED}❌ $1${NC}"; }
headx() { echo -e "\n${BLUE}==================== $1 ====================${NC}"; }

check_http() {
  local name="$1"
  local cmd="$2"
  headx "$name"
  echo "$cmd"
  eval "$cmd"
}

echo
echo "ProxiNG Deep Diagnostic"
echo "Time: $(date)"
echo "Host: $(hostname)"
echo

headx "1. PM2 STATUS"
pm2 list || true

headx "2. NGINX STATUS"
sudo systemctl status nginx --no-pager || true

headx "3. NGINX CONFIG TEST"
sudo nginx -t || true

headx "4. ACTIVE NGINX API BLOCKS"
sudo nginx -T 2>/dev/null | grep -nE "server_name|location /api|proxy_pass|location /socket.io|root " || true

headx "5. LOCAL BACKEND HEALTH"
echo "GET ${API_LOCAL}/health"
curl -i -s "${API_LOCAL}/health"
echo
echo "GET ${API_LOCAL}/api/health"
curl -i -s "${API_LOCAL}/api/health"
echo

headx "6. PUBLIC HEALTH VIA NGINX"
echo "GET ${DOMAIN}/health"
curl -i -s "${DOMAIN}/health"
echo
echo "GET ${DOMAIN}/api/health"
curl -i -s "${DOMAIN}/api/health"
echo

headx "7. AUTH LOGIN LOCAL"
LOGIN_BODY='{"phone":"09138511306","password":"Alquran2"}'
echo "POST ${API_LOCAL}/api/auth/login"
curl -i -s -X POST "${API_LOCAL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "${LOGIN_BODY}"
echo

headx "8. AUTH LOGIN PUBLIC"
echo "POST ${DOMAIN}/api/auth/login"
curl -i -s -X POST "${DOMAIN}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "${LOGIN_BODY}"
echo

headx "9. FRONTEND HARDCODED API LEAKS"
if [ -d /var/www/proxing ]; then
  cd /var/www/proxing || exit 1
  echo "-- src hits --"
  grep -RInE "api\.proxing\.online|127\.0\.0\.1:4000|localhost:4000|http://|https://api/" src 2>/dev/null || true
  echo
  echo "-- dist hits --"
  grep -RInE "api\.proxing\.online|127\.0\.0\.1:4000|localhost:4000|http://|https://api/" dist 2>/dev/null || true
else
  warn "/var/www/proxing not found"
fi

headx "10. BACKEND ROUTE DISCOVERY"
cd /root/proxing-enterprise || exit 1
grep -RInE "auth/login|auth/register|auth/reissue|paystack|monnify|webhook|merchant-verify|service-variations|vtpass|router\.(get|post|put|delete)" src 2>/dev/null | head -n 400 || true

headx "11. VTU / SMS ROUTES LOCAL"
echo "POST ${API_LOCAL}/api/sms"
curl -i -s -X POST "${API_LOCAL}/api/sms" \
  -H "Content-Type: application/json" \
  -d '{"from":"09137439655","message":"send 200 airtime to 09014631669"}'
echo

headx "12. VTU / SMS ROUTES PUBLIC"
echo "POST ${DOMAIN}/api/sms"
curl -i -s -X POST "${DOMAIN}/api/sms" \
  -H "Content-Type: application/json" \
  -d '{"from":"09137439655","message":"send 200 airtime to 09014631669"}'
echo

headx "13. PAYSTACK/MONNIFY ROUTE PROBES LOCAL"
for p in \
  "/api/paystack-va/generate" \
  "/api/monnify/generate-account" \
  "/api/monnify/generate-reserved-account" \
  "/api/paystack/webhook" \
  "/api/monnify/webhook"
do
  echo "PROBE $p"
  curl -i -s "${API_LOCAL}${p}"
  echo
done

headx "14. PAYSTACK/MONNIFY ROUTE PROBES PUBLIC"
for p in \
  "/api/paystack-va/generate" \
  "/api/monnify/generate-account" \
  "/api/monnify/generate-reserved-account" \
  "/api/paystack/webhook" \
  "/api/monnify/webhook"
do
  echo "PROBE $p"
  curl -i -s "${DOMAIN}${p}"
  echo
done

headx "15. VTU SERVICE VARIATION ROUTES"
for p in \
  "/api/vtpass/service-variations?serviceID=mtn-data" \
  "/api/vtpass/service-variations?serviceID=airtel-data" \
  "/api/vtpass/service-variations?serviceID=glo-data" \
  "/api/vtpass/service-variations?serviceID=etisalat-data"
do
  echo "PROBE $p"
  curl -i -s "${DOMAIN}${p}"
  echo
done

headx "16. ENVIRONMENT SNAPSHOT"
echo "Node app env from current shell:"
env | grep -E "VTPASS|MONNIFY|PAYSTACK|SUPABASE|API_BASE|PROXING" || true
echo
echo "PM2 ecosystem references:"
grep -RInE "VTPASS|MONNIFY|PAYSTACK|SUPABASE|API_BASE|PROXING" ecosystem* . 2>/dev/null || true

headx "17. BACKEND ERROR LOGS"
pm2 logs proxing-api --lines 80 --nostream 2>/dev/null || true

headx "18. NGINX ERROR LOG"
sudo tail -n 80 /var/log/nginx/error.log 2>/dev/null || true

headx "19. NGINX ACCESS LOG"
sudo tail -n 80 /var/log/nginx/access.log 2>/dev/null || true

headx "20. QUICK FINDINGS HINTS"
echo "Interpretation guide:"
echo "- If local login works but public login fails => nginx /api proxy problem"
echo "- If public login works but utility pages fail => frontend hardcoded API URLs or wrong backend routes"
echo "- If grep finds api.proxing.online in src/dist => frontend still bypasses nginx"
echo "- If /api/health fails but /health works => backend route mismatch"
echo "- If webhook paths 404 => wrong backend route names or wrong nginx forwarding"
echo "- If VTU variation routes fail => frontend/backend contract mismatch"
echo "- If paystack/monnify generate routes fail => route name drift or auth/base URL issues"
echo
ok "Diagnostics completed"
