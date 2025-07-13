class SidebarGenerator {
    constructor() {
        this.sidebar = document.getElementById('sidebar');
        this.config = null;
    }

    async initialize() {
        if (!this.sidebar) {
            return;
        }

        try {
            await this.loadConfig();
            this.generateSidebar();
        } catch (error) {
        }
    }

    async loadConfig() {
        const response = await fetch('config/api-spec.json');
        this.config = await response.json();
    }

    generateSidebar() {
        let sidebarHTML = '';
        
        if (this.config.navigation) {
            sidebarHTML += `
                <div class="sidebar-section">
                    <h6 class="sidebar-title">Guías</h6>
                    <nav class="sidebar-nav">
                        <ul>
                            ${this.config.navigation.map(item => `
                                <li class="sidebar-nav-item">
                                    <a href="#${item.id}" class="sidebar-nav-link">
                                        <i class="${item.icon}"></i>
                                        ${item.title}
                                    </a>
                                </li>
                            `).join('')}
                        </ul>
                    </nav>
                </div>
            `;
        }
        
        if (this.config.sections) {
            this.config.sections.forEach(section => {
                sidebarHTML += `
                    <div class="sidebar-section">
                        <h6 class="sidebar-title">${section.title}</h6>
                        <nav class="sidebar-nav">
                            <ul>
                `;
                
                if (section.endpoints) {
                    sidebarHTML += section.endpoints.map(endpoint => `
                        <li class="sidebar-nav-item">
                            <a href="#${endpoint.id}" class="sidebar-nav-link">
                                ${endpoint.method ? `<span class="method-badge method-${endpoint.method.toLowerCase()}">${endpoint.method}</span>` : `<i class="${endpoint.icon || 'fas fa-code'}"></i>`}
                                ${endpoint.title}
                            </a>
                        </li>
                    `).join('');
                }
                
                if (section.pages) {
                    sidebarHTML += section.pages.map(page => `
                        <li class="sidebar-nav-item">
                            <a href="#${page.id}" class="sidebar-nav-link">
                                <i class="${page.icon || 'fas fa-file-alt'}"></i>
                                ${page.title}
                            </a>
                        </li>
                    `).join('');
                }
                
                sidebarHTML += `
                            </ul>
                        </nav>
                    </div>
                `;
            });
        }

        this.sidebar.innerHTML = sidebarHTML;
    }

    updateActiveNavigation(route) {
        const links = document.querySelectorAll('.sidebar-nav-link');
        links.forEach(link => {
            const href = link.getAttribute('href');
            if (href === `#${route}`) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }
}

window.SidebarGenerator = SidebarGenerator; 
