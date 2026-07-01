#!/bin/bash
set -euo pipefail

echo "Marketing Studio — Vercel deploy"
echo "================================"

cd "$(dirname "$0")"

if ! command -v vercel &> /dev/null && [ ! -f node_modules/.bin/vercel ]; then
  echo "Installing dependencies (includes Vercel CLI)..."
  npm install
fi

VERCEL_BIN="${VERCEL_BIN:-./node_modules/.bin/vercel}"

if [ ! -f .vercel/project.json ]; then
  echo ""
  echo "Link this app to a new Vercel project (root: apps/marketing-studio):"
  echo "  $VERCEL_BIN link"
  echo ""
  echo "Suggested project name: wisecall-marketing-studio"
  exit 1
fi

echo "Building..."
npm run build

echo ""
read -p "Deploy to production? (y/N): " prod
if [[ "${prod,,}" == "y" ]]; then
  "$VERCEL_BIN" --prod
else
  "$VERCEL_BIN"
fi

echo ""
echo "Done. Set env vars with: $VERCEL_BIN env pull .env.local"
