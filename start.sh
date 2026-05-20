#!/bin/bash
echo "🎓 Starting Exam Seating Platform..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️  Created .env from template — please update JWT_SECRET before production use"
fi
node server.js
