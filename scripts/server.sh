#!/usr/bin/env bash
set -euo pipefail
export AWS_PROFILE="${AWS_PROFILE:-valheim}"
STACK="${STACK_NAME:-ValheimServerStack}"

output() {
  aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

secret_json() {
  aws secretsmanager get-secret-value --secret-id "$(output SecretArn)" --query SecretString --output text
}

# Runs one shell command on the instance through SSM and prints status, stdout, stderr.
run_on_server() {
  local id cmd_id
  id="$(output InstanceId)"
  cmd_id="$(aws ssm send-command --instance-ids "$id" --document-name AWS-RunShellScript \
    --parameters "commands=[\"$1\"]" --query Command.CommandId --output text)"
  aws ssm wait command-executed --command-id "$cmd_id" --instance-id "$id" || true
  aws ssm get-command-invocation --command-id "$cmd_id" --instance-id "$id" \
    --query '[Status, StandardOutputContent, StandardErrorContent]' --output text
}

case "${1:-}" in
  ip)
    echo "Join IP:          $(output ConnectString)"
    echo "Steam favorites:  $(output SteamFavoritesString)" ;;
  status)
    aws ec2 describe-instances --instance-ids "$(output InstanceId)" \
      --query 'Reservations[0].Instances[0].State.Name' --output text ;;
  start)
    aws ec2 start-instances --instance-ids "$(output InstanceId)" \
      --query 'StartingInstances[0].CurrentState.Name' --output text ;;
  stop)
    aws ec2 stop-instances --instance-ids "$(output InstanceId)" \
      --query 'StoppingInstances[0].CurrentState.Name' --output text ;;
  restart)
    run_on_server 'systemctl restart valheim && systemctl is-active valheim' ;;
  logs)
    run_on_server "docker logs --tail ${2:-100} valheim 2>&1" ;;
  service)
    run_on_server 'systemctl status valheim --no-pager; df -h /opt/valheim; ls -la /opt/valheim/config/worlds_local 2>/dev/null' ;;
  panel)
    echo "Control panel: $(output PanelUrl)" ;;
  shell)
    aws ssm start-session --target "$(output InstanceId)" ;;
  password)
    secret_json | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])' ;;
  set-webhook)
    [ -n "${2:-}" ] || { echo "usage: $0 set-webhook <discord webhook url>" >&2; exit 1; }
    updated="$(secret_json | python3 -c 'import json,sys; d=json.load(sys.stdin); d["discordWebhook"]=sys.argv[1]; print(json.dumps(d))' "$2")"
    aws secretsmanager put-secret-value --secret-id "$(output SecretArn)" --secret-string "$updated" \
      --query VersionId --output text
    echo "Stored. Run: npm run server -- restart (the service re-reads the secret on start)" ;;
  set-password)
    [ -n "${2:-}" ] || { echo "usage: $0 set-password <password>" >&2; exit 1; }
    [ "${#2}" -ge 5 ] || { echo "Valheim needs at least 5 characters" >&2; exit 1; }
    name="$(sed -n "s/.*serverName: '\([^']*\)'.*/\1/p" "$(dirname "$0")/../lib/config.ts")"
    case "$name" in *"$2"*) echo "Valheim rejects a password that appears inside the server name ($name)" >&2; exit 1 ;; esac
    updated="$(secret_json | python3 -c 'import json,sys; d=json.load(sys.stdin); d["password"]=sys.argv[1]; print(json.dumps(d))' "$2")"
    aws secretsmanager put-secret-value --secret-id "$(output SecretArn)" --secret-string "$updated" \
      --query VersionId --output text
    echo "Stored. Run: npm run server -- restart (the service re-reads the secret on start; panel logins use the new password within 5 minutes)" ;;
  *)
    echo "usage: $0 {ip|panel|status|start|stop|restart|logs [lines]|service|shell|password|set-webhook <url>|set-password <password>}" >&2
    exit 1 ;;
esac
