import requests

url = 'https://api.capidocs.dev/v2/documents'
headers = {
    'Authorization': 'Bearer YOUR_API_KEY',
    'Content-Type': 'application/json'
}

params = {
    'page': 1,
    'limit': 20,
    'search': 'api'
}

response = requests.get(url, headers=headers, params=params)
data = response.json()

if data['success']:
    print(f"Found {len(data['data'])} documents")
    for doc in data['data']:
        print(f"- {doc['title']} ({doc['slug']})")
else:
    print(f"Error: {data['error']['message']}")
