# Cloudflare API トークン（1Password の参照だけ。値は入れない）
# vault spq6och5whsaody6m3ngapbs6u = Personal、項目 = Cloudflare API Token（wrangler の Shell Plugin と同じもの）
# deploy / kv:setup / secrets:setup が op run 経由で読む。dev の vars に混ざらないよう .env.tpl とは分けている
CLOUDFLARE_API_TOKEN=op://spq6och5whsaody6m3ngapbs6u/Cloudflare API Token/token
