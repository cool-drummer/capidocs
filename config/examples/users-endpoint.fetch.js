const response = await fetch('https://api.capidocs.dev/v2/documents?page=1&limit=20', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
if (data.success) {
  console.log('Documents:', data.data);
  console.log('Total:', data.pagination.total);
} else {
  console.error('Error:', data.error.message);
}
