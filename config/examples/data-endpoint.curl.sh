curl -X POST https://api.capidocs.dev/v2/documents \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Getting Started Guide",
    "content": "This guide helps you get started with capidocs",
    "category": "guides",
    "metadata": {
      "priority": "high",
      "tags": ["guide", "getting-started"]
    }
  }'
