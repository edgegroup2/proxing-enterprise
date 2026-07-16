#!/bin/bash
set -euo pipefail

LOG="/var/log/proxing-reconcile.log"
APP_DIR="/root/proxing-enterprise"
JOB_NAME="reconcile-nightly"
JOB_FILE="src/jobs/runCommissionReconcileOnce.js"

echo "===== Nightly reconcile started at $(date) =====" >> "$LOG"

cd "$APP_DIR"

# Start one-shot process
pm2 start "$JOB_FILE" --name "$JOB_NAME" --no-autorestart >> "$LOG" 2>&1

# Wait until it stops (max 10 mins)
timeout 600 bash -c "
  while pm2 jlist | grep -q '\"name\":\"$JOB_NAME\"' && pm2 jlist | grep -q '\"name\":\"$JOB_NAME\"' | true; do
    STATUS=\$(pm2 jlist | node -e '
      const fs=require(\"fs\");
      const d=JSON.parse(fs.readFileSync(0,\"utf8\"));
      const p=d.find(x=>x.name===\"$JOB_NAME\");
      console.log(p ? p.pm2_env.status : \"missing\");
    ');
    [ \"\$STATUS\" = \"stopped\" ] && exit 0
    sleep 2
  done
" >> "$LOG" 2>&1 || echo "WARN: reconcile timed out" >> "$LOG"

# Cleanup
pm2 delete "$JOB_NAME" >> "$LOG" 2>&1 || true

echo "===== Nightly reconcile finished at $(date) =====" >> "$LOG"
