class SyntaxHighlighter {
    constructor() {
        this.initializePrism();
        this.observers = new Map();
        this.init();
    }

    initializePrism() {
        if (typeof Prism !== 'undefined') {
            Prism.manual = true;
        }
    }

    init() {
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.initializeAll());
        } else {
            this.initializeAll();
        }
        
        
        window.addEventListener('load', () => {
            setTimeout(() => this.initializeAll(), 100);
        });
    }

    initializeAll() {
        this.highlightAllInContainer();
        this.observeContainer(document.body);
    }

    highlightElement(element) {
        if (typeof Prism !== 'undefined' && element) {
            Prism.highlightElement(element);
        }
    }

    highlightAllInContainer(container = document) {
        if (typeof Prism !== 'undefined') {
            const codeElements = container.querySelectorAll('pre code[class*="language-"]');
            codeElements.forEach(element => {
                if (!element.classList.contains('highlighted')) {
                    this.highlightElement(element);
                    element.classList.add('highlighted');
                }
            });
            
            
            setTimeout(() => this.initializeLineNumbers(container), 50);
        }
    }

    initializeLineNumbers(container = document) {
        if (typeof Prism !== 'undefined' && Prism.plugins && Prism.plugins.lineNumbers) {
            const lineNumberElements = container.querySelectorAll('pre.line-numbers');
            lineNumberElements.forEach(pre => {
                
                const existing = pre.querySelector('.line-numbers-rows');
                if (existing) {
                    existing.remove();
                }
                
                
                Prism.plugins.lineNumbers.resize(pre);
            });
        }
    }

    observeContainer(container, callback) {
        if (this.observers.has(container)) {
            return;
        }

        const observer = new MutationObserver((mutations) => {
            let shouldHighlight = false;
            
            mutations.forEach(mutation => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1) {
                            if (node.matches && node.matches('pre code[class*="language-"]')) {
                                shouldHighlight = true;
                            } else if (node.querySelectorAll) {
                                const codeElements = node.querySelectorAll('pre code[class*="language-"]');
                                if (codeElements.length > 0) {
                                    shouldHighlight = true;
                                }
                            }
                        }
                    });
                }
            });

            if (shouldHighlight) {
                setTimeout(() => {
                    this.highlightAllInContainer(container);
                    if (callback) callback();
                }, 10);
            }
        });

        observer.observe(container, {
            childList: true,
            subtree: true
        });

        this.observers.set(container, observer);
    }

    disconnectObserver(container) {
        const observer = this.observers.get(container);
        if (observer) {
            observer.disconnect();
            this.observers.delete(container);
        }
    }

    disconnectAllObservers() {
        this.observers.forEach(observer => observer.disconnect());
        this.observers.clear();
    }

    refresh() {
        this.highlightAllInContainer();
    }

    forceSyntaxHighlighting() {
        let attempts = 0;
        const maxAttempts = 3;
        
        const forceHighlight = () => {
            attempts++;
            
            if (typeof Prism !== 'undefined') {
                
                document.querySelectorAll('code.highlighted').forEach(el => {
                    el.classList.remove('highlighted');
                });
                
                
                document.querySelectorAll('pre code[class*="language-"]').forEach(el => {
                    this.highlightElement(el);
                    el.classList.add('highlighted');
                });
                
                console.log(`Syntax highlighting forced (attempt ${attempts})`);
            } else if (attempts < maxAttempts) {
                setTimeout(forceHighlight, 200);
            }
        };
        
        forceHighlight();
    }
}


const syntaxHighlighter = new SyntaxHighlighter();


window.syntaxHighlighter = syntaxHighlighter;
window.forceSyntaxHighlighting = () => syntaxHighlighter.forceSyntaxHighlighting(); 