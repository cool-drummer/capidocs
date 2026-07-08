# Capidocs - Professional API Documentation Template

A modern, responsive, and fully configurable documentation template for REST APIs. Transform your API documentation into a professional, branded experience in minutes.

## 🌟 Live Demo

- **Dark Theme**: Professional dark mode with excellent contrast
- **Light Theme**: Clean, modern light interface
- **Mobile Responsive**: Perfect on all devices
- **Interactive**: Live code examples and syntax highlighting

## ✨ Key Features

### 🔧 100% Configurable
- **JSON Configuration + plain code files**: Structure lives in `config/api-spec.json`; multi-line code samples live as real files under `config/examples/` (referenced with `file`), so you never escape `\n` or `\"` by hand
- **No Code Changes Required**: Customize content, branding, and structure without touching code
- **Multiple Page Types**: Hero pages, content pages, and API endpoint documentation

### 🎨 Professional Design
- **Dual Theme Support**: Automatic dark/light mode with user preference persistence
- **Brand Customization**: Logo integration, color schemes, and custom branding
- **Responsive Layout**: Mobile-first design that works on all screen sizes
- **Modern UI**: Clean typography, smooth animations, and professional aesthetics

### 🚀 Developer Experience
- **Multi-language Code Examples**: Support for 10+ programming languages
- **Syntax Highlighting**: Beautiful code blocks with copy-to-clipboard functionality
- **Interactive Navigation**: Smooth routing with table of contents
- **SEO Optimized**: Proper meta tags and semantic HTML structure

### 🔒 Security First
- **XSS Protection**: Sanitized content and safe DOM manipulation
- **No Inline JavaScript**: Clean separation of concerns
- **Input Validation**: All configuration is validated and sanitized
- **HTTPS Ready**: Designed for secure deployment

## 📋 Quick Start

### 1. Download and Setup
```bash
# Clone or download the repository
git clone https://github.com/cool-drummer/capidocs.git
cd capidocs

# Or download as ZIP and extract
```

### 2. Customize Your Branding
Replace the logo files in the `logos/` folder with your brand assets:

```
logos/
├── logo-light.svg    # Navigation logo for light theme
├── logo-dark.svg     # Navigation logo for dark theme  
├── logo-hero.svg     # Main page header logo
├── favicon.svg       # Browser favicon
└── logo-footer.svg   # Footer logo
```

**Logo Specifications:**
- **Format**: SVG (recommended for scalability)
- **navbar_light/dark**: 120×32px - Navigation bar logos
- **hero**: 200×60px - Main page header logo
- **icon**: 32×32px - Favicon and small icons
- **footer**: 160×40px - Footer logo

### 3. Configure Your API Documentation
Edit `config/api-spec.json` with your API details (see configuration guide below).

### 4. Deploy
Upload to any static hosting service:
- GitHub Pages
- Netlify
- Vercel
- AWS S3
- Any web server

## ⚙️ Configuration Guide

### Site Configuration

```json
{
  "site_config": {
    "name": "Your API Documentation",
    "brand": "YourBrand™",
    "brand_icon": "fas fa-cube",
    "use_logos": true,
    "default_theme": "dark",
    "logos": {
      "navbar_light": "logos/logo-light.svg",
      "navbar_dark": "logos/logo-dark.svg",
      "hero": "logos/logo-hero.svg",
      "icon": "logos/favicon.svg",
      "footer": "logos/logo-footer.svg"
    }
  }
}
```

**Configuration Options:**
- `name`: Site title shown in browser tabs
- `brand`: Brand name displayed in navigation
- `brand_icon`: FontAwesome icon when logos are disabled
- `use_logos`: Set to `false` to use text + icon instead of logos
- `default_theme`: "light" or "dark" default theme

### API Information

```json
{
  "api": {
    "name": "Your API Service",
    "version": "2.1.0",
    "description": "Complete API for managing your application data",
    "base_url": "https://api.yourdomain.com/v2"
  }
}
```

### Navigation Structure

```json
{
  "navigation": [
    {
      "id": "home",
      "title": "Home",
      "icon": "fas fa-home",
      "type": "page"
    },
    {
      "id": "getting-started",
      "title": "Getting Started",
      "icon": "fas fa-play-circle",
      "type": "page"
    },
    {
      "id": "authentication",
      "title": "Authentication",
      "icon": "fas fa-key",
      "type": "page"
    }
  ]
}
```

### Page Content

#### Hero Page (Homepage)
```json
{
  "pages": {
    "home": {
      "template": "hero",
      "content": {
        "hero": {
          "title": "Your API Name",
          "subtitle": "Professional API Documentation",
          "stats": [
            {"number": "99.9%", "label": "Uptime"},
            {"number": "<50ms", "label": "Response Time"},
            {"number": "24/7", "label": "Support"}
          ],
          "buttons": [
            {
              "text": "Get Started",
              "href": "#getting-started",
              "type": "primary",
              "icon": "fas fa-rocket"
            }
          ]
        },
        "features": {
          "title": "Core Features",
          "subtitle": "Everything you need for your API",
          "items": [
            {
              "icon": "fas fa-users",
              "title": "User Management",
              "description": "Complete user authentication and management system",
              "link": "#authentication"
            }
          ]
        }
      }
    }
  }
}
```

#### Content Page
```json
{
  "pages": {
    "getting-started": {
      "template": "content",
      "content": {
        "title": "Getting Started",
        "description": "Learn how to integrate our API quickly and efficiently",
        "sections": [
          {
            "title": "Authentication",
            "content": "All API requests require authentication using API keys.",
            "code": {
              "language": "bash",
              "title": "Example Request",
              "content": "curl -H \"Authorization: Bearer YOUR_API_KEY\" https://api.yourdomain.com/v2/users"
            }
          },
          {
            "title": "Response Format",
            "content": "All responses follow a consistent JSON structure:",
            "code": {
              "language": "json",
              "title": "Standard Response",
              "content": "{\n  \"success\": true,\n  \"data\": {},\n  \"message\": \"Request successful\"\n}"
            }
          }
        ]
      }
    }
  }
}
```

### API Endpoints

```json
{
  "endpoints": {
    "users-list": {
      "method": "GET",
      "path": "/users",
      "title": "List Users",
      "description": "Retrieve a paginated list of users",
      "authentication": true,
      "request": {
        "headers": [
          {
            "name": "Authorization",
            "value": "Bearer YOUR_API_KEY",
            "required": true,
            "description": "API authentication token"
          }
        ],
        "query_params": [
          {
            "name": "page",
            "type": "integer",
            "description": "Page number for pagination",
            "example": "1"
          },
          {
            "name": "limit",
            "type": "integer",
            "description": "Items per page (max 100)",
            "example": "20"
          }
        ]
      },
      "responses": {
        "200": {
          "description": "Success - Users retrieved",
          "examples": {
            "success": {
              "summary": "Successful response",
              "value": {
                "success": true,
                "data": [
                  {
                    "id": "usr_12345",
                    "name": "John Doe",
                    "email": "john@example.com",
                    "created_at": "2024-01-15T10:30:00Z"
                  }
                ],
                "pagination": {
                  "page": 1,
                  "total": 150,
                  "has_more": true
                }
              }
            }
          }
        },
        "401": {
          "description": "Unauthorized - Invalid API key",
          "examples": {
            "error": {
              "summary": "Authentication failed",
              "value": {
                "success": false,
                "error": {
                  "code": "UNAUTHORIZED",
                  "message": "Invalid API key"
                }
              }
            }
          }
        }
      },
      "code_examples": [
        {
          "id": "users-curl",
          "tech": "curl",
          "name": "cURL",
          "language": "bash",
          "title": "Get Users with cURL",
          "description": "Retrieve users using cURL",
          "code": "curl -X GET 'https://api.yourdomain.com/v2/users?page=1&limit=20' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Content-Type: application/json'"
        },
        {
          "id": "users-javascript",
          "tech": "javascript",
          "name": "JavaScript",
          "language": "javascript",
          "title": "Fetch Users with JavaScript",
          "description": "Get users using fetch API",
          "code": "const response = await fetch('https://api.yourdomain.com/v2/users', {\n  method: 'GET',\n  headers: {\n    'Authorization': 'Bearer YOUR_API_KEY',\n    'Content-Type': 'application/json'\n  }\n});\n\nconst data = await response.json();\nconsole.log(data);"
        }
      ]
    }
  }
}
```

## 🎨 Theming and Customization

### Color Scheme
```json
{
  "theme": {
    "colors": {
      "primary": "#007bff",
      "secondary": "#6c757d",
      "success": "#28a745",
      "warning": "#ffc107",
      "error": "#dc3545",
      "info": "#17a2b8"
    }
  }
}
```

### Features Toggle
```json
{
  "features": {
    "syntax_highlighting": true,
    "code_copy": true,
    "dark_mode": true,
    "search": false,
    "mobile_responsive": true
  }
}
```

## 📖 Content Types

### Supported Content Elements

#### Text Content
```json
{
  "title": "Section Title",
  "content": "Your content here with **markdown** support"
}
```

#### Code Blocks

There are three ways to provide code, from most to least recommended. All of them
support `language` (for syntax highlighting) and an optional `title`.

**1. External file (recommended for anything multi-line).** Keep the code as a real
file under `config/examples/` and reference it with `file`. No escaping, editor
highlighting, and the sample stays runnable/testable on its own.

```json
{
  "code": {
    "language": "javascript",
    "title": "Example Code",
    "file": "config/examples/quick-start.js"
  }
}
```

If you omit `language`, it is inferred from the file extension
(`.sh`/`.curl` → bash, `.py` → python, `.js` → javascript, `.json`, `.http`, `.yaml`, `.txt`).

**2. Array of lines (handy for short inline snippets).** Each array item is one line;
they are joined with newlines automatically, so you never write `\n`.

```json
{
  "code": {
    "language": "bash",
    "content": [
      "curl -X GET https://api.example.com/v2/users \\",
      "  -H 'Authorization: Bearer YOUR_API_KEY'"
    ]
  }
}
```

**3. Inline string (single line or legacy).** Still fully supported.

```json
{
  "code": {
    "language": "javascript",
    "title": "Example Code",
    "content": "const api = new ApiClient();"
  }
}
```

> **Precedence:** if `file` is present it wins over inline `content`/`code`. Endpoint
> `code_examples[]` use the same rules, but the code field is named `code` instead of
> `content`. If a referenced file fails to load, that single block shows a placeholder and
> the rest of the page keeps working.

#### Lists
```json
{
  "list": [
    "First item",
    "Second item", 
    "Third item"
  ]
}
```

#### Tables
```json
{
  "table": {
    "headers": ["Method", "Endpoint", "Description"],
    "rows": [
      ["GET", "/users", "List users"],
      ["POST", "/users", "Create user"]
    ]
  }
}
```

#### Notes and Alerts
```json
{
  "note": "Important information for developers",
  "warning": "This endpoint is deprecated"
}
```

## 🔧 Advanced Configuration

### Table of Contents
```json
{
  "toc": {
    "enabled": true,
    "min_headings": 2,
    "exclude_pages": ["home"],
    "exclude_headings": {
      "texts": ["Notice", "Warning"],
      "selectors": [".alert h4"]
    }
  }
}
```

### Warning Messages
```json
{
  "warning_message": {
    "title": "Development Environment",
    "content": "This is a development version. Production endpoints may differ.",
    "type": "info"
  },
  "show_warning_on_pages": true,
  "exclude_warning_routes": ["home"]
}
```

### Page Titles
```json
{
  "page_titles": {
    "base_title": "Your API - Documentation",
    "separator": " | ",
    "routes": {
      "home": "Home",
      "getting-started": "Getting Started",
      "authentication": "Authentication"
    }
  }
}
```

## 🚀 Deployment

### Static Hosting (Recommended)
1. **GitHub Pages**
   ```bash
   # Push to gh-pages branch
   git push origin gh-pages
   ```

2. **Netlify**
   - Drag and drop your folder
   - Or connect to your Git repository

3. **Vercel**
   ```bash
   npm install -g vercel
   vercel --prod
   ```

4. **AWS S3**
   ```bash
   aws s3 sync . s3://your-bucket-name --delete
   ```

### Requirements
- Modern web browser (Chrome 70+, Firefox 70+, Safari 12+, Edge 79+)
- HTTPS recommended for production
- No server-side processing required

## 🛠️ Development

### File Structure
```
capidocs/
├── assets/
│   ├── css/
│   │   └── capidocs.css          # Main stylesheet
│   └── js/
│       ├── core.js               # Core functionality
│       ├── router.js             # Page routing
│       ├── content-generator.js  # Content rendering
│       └── syntax-highlighter.js # Code highlighting
├── config/
│   └── api-spec.json            # Main configuration
├── logos/                       # Brand assets
└── index.html                   # Main HTML file
```

### Customizing Styles
Modify `assets/css/capidocs.css` to customize:
- Colors and theming
- Typography
- Layout spacing
- Component styles

### Adding New Features
1. Extend the configuration schema in `api-spec.json`
2. Update the content generator to handle new content types
3. Add corresponding CSS styles
4. Test across themes and devices

## 📱 Browser Support

| Browser | Version |
|---------|---------|
| Chrome  | 70+     |
| Firefox | 70+     |
| Safari  | 12+     |
| Edge    | 79+     |

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 🎯 Best Practices

### Content Organization
- Start with a compelling homepage hero section
- Organize API endpoints logically
- Provide comprehensive code examples
- Include proper error handling documentation

### SEO Optimization
- Use descriptive page titles
- Include meta descriptions
- Structure content with proper headings
- Optimize images and assets

### Performance
- Minimize JSON configuration size
- Optimize logo file sizes
- Use efficient code examples
- Test loading times

### Security
- Always use HTTPS in production
- Validate all configuration inputs
- Keep dependencies updated
- Review code examples for security

---

**Ready to create professional API documentation?** Start by editing `config/api-spec.json` and replacing the logos with your brand assets. Your documentation will be ready in minutes!

For questions or support, please open an issue in the repository. 