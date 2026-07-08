const payload = {
  title: 'Getting Started Guide',
  content: 'This guide helps you get started with capidocs',
  category: 'guides',
  metadata: {
    priority: 'high',
    tags: ['guide', 'getting-started']
  }
};

const response = await fetch('https://api.capidocs.dev/v2/documents', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
});

const data = await response.json();
if (data.success) {
  console.log('Created document:', data.data.id);
} else {
  console.error('Error:', data.error.message);
}
