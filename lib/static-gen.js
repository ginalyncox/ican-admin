const fs = require('fs');
const path = require('path');

const WEBSITE_DIR = path.join(__dirname, '..', '..', 'ican-website');
const BLOG_DIR = path.join(WEBSITE_DIR, 'blog');

function ensureBlogDir() {
  if (!fs.existsSync(BLOG_DIR)) {
    fs.mkdirSync(BLOG_DIR, { recursive: true });
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatRFC822(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toUTCString();
}

function categoryLabel(cat) {
  const labels = {
    'announcement': 'Announcement',
    'legislative': 'Legislative',
    'victory-garden': 'Victory Garden',
    'community': 'Community',
    'opinion': 'Opinion'
  };
  return labels[cat] || cat || 'Update';
}

function escapeXml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function generatePostHTML(post) {
  ensureBlogDir();

  // Handle both absolute URLs and relative paths for featured images
  let featuredImageSrc = '';
  if (post.featured_image) {
    if (post.featured_image.startsWith('http://') || post.featured_image.startsWith('https://')) {
      featuredImageSrc = post.featured_image;
    } else {
      featuredImageSrc = `../${post.featured_image}`;
    }
  }
  const featuredImageBlock = featuredImageSrc
    ? `<img src="${featuredImageSrc}" alt="${escapeXml(post.title)}" class="blog-post__featured-image" width="960" height="540" loading="eager" decoding="async">`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeXml(post.title)} — ICAN Blog</title>
<meta name="description" content="${escapeXml(post.excerpt || '')}">
<meta property="og:title" content="${escapeXml(post.title)}">
<meta property="og:description" content="${escapeXml(post.excerpt || '')}">
<meta property="og:type" content="article">

<!-- Fonts -->
<link href="https://api.fontshare.com/v2/css?f[]=zodiak@400,500,600,700&display=swap" rel="stylesheet">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@300..700&display=swap" rel="stylesheet">

<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg viewBox='0 0 32 32' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M16 2 C16 2 13 8 9 12 C5 16 4 20 6 24 C8 28 12 30 16 30 C20 30 24 28 26 24 C28 20 27 16 23 12 C19 8 16 2 16 2Z' fill='%232D6A3F'/%3E%3Cpath d='M16 8 L16 24' stroke='%23F5F3ED' stroke-width='1.5' stroke-linecap='round'/%3E%3Cpath d='M16 14 L12 11' stroke='%23F5F3ED' stroke-width='1.2' stroke-linecap='round'/%3E%3Cpath d='M16 14 L20 11' stroke='%23F5F3ED' stroke-width='1.2' stroke-linecap='round'/%3E%3Cpath d='M16 18 L11 15.5' stroke='%23F5F3ED' stroke-width='1.2' stroke-linecap='round'/%3E%3Cpath d='M16 18 L21 15.5' stroke='%23F5F3ED' stroke-width='1.2' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="stylesheet" href="../base.css">
<link rel="stylesheet" href="../style.css">
</head>
<body>

<a href="#main" class="skip-link">Skip to content</a>

<!-- HEADER -->
<header class="header" role="banner">
  <div class="header__inner">
    <a href="../index.html" class="header__logo" aria-label="ICAN Home">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" width="32" height="32">
        <path d="M16 2 C16 2 13 8 9 12 C5 16 4 20 6 24 C8 28 12 30 16 30 C20 30 24 28 26 24 C28 20 27 16 23 12 C19 8 16 2 16 2Z" fill="currentColor" opacity="0.9"/>
        <path d="M16 8 L16 24" stroke="var(--color-bg)" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M16 14 L12 11" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16 14 L20 11" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16 18 L11 15.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16 18 L21 15.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16 22 L12.5 19.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16 22 L19.5 19.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
      <span class="header__logo-text">ICAN</span>
    </a>
    <nav class="header__nav" aria-label="Main navigation">
      <a href="../index.html" class="header__nav-link">Home</a>
      <a href="../about.html" class="header__nav-link">About</a>
      <a href="../victory-garden.html" class="header__nav-link">Victory Garden</a>
      <a href="../legislative.html" class="header__nav-link">Legislative</a>
      <a href="../blog.html" class="header__nav-link header__nav-link--active">Blog</a>
      <a href="../get-involved.html" class="header__nav-link">Get Involved</a>
    </nav>
    <div class="header__actions">
      <button class="theme-toggle" data-theme-toggle aria-label="Switch to dark mode">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <button class="mobile-menu-btn" aria-label="Open menu" aria-expanded="false">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
      </button>
    </div>
  </div>
</header>

<div class="mobile-nav" role="dialog" aria-label="Navigation menu">
  <button class="mobile-nav__close" aria-label="Close menu">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
  </button>
  <a href="../index.html" class="mobile-nav__link">Home</a>
  <a href="../about.html" class="mobile-nav__link">About</a>
  <a href="../victory-garden.html" class="mobile-nav__link">Victory Garden</a>
  <a href="../legislative.html" class="mobile-nav__link">Legislative</a>
  <a href="../blog.html" class="mobile-nav__link mobile-nav__link--active">Blog</a>
  <a href="../get-involved.html" class="mobile-nav__link">Get Involved</a>
</div>

<main id="main">
  <article class="blog-post reveal">
    <a href="../blog.html" class="blog-post__back">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      Back to Blog
    </a>

    <header class="blog-post__header">
      <span class="blog-post__category">${categoryLabel(post.category)}</span>
      <h1 class="blog-post__title">${escapeXml(post.title)}</h1>
      <div class="blog-post__meta">
        <span>By ${escapeXml(post.author_name || 'ICAN Staff')}</span>
        <span class="blog-post__meta-divider"></span>
        <time datetime="${post.published_at || post.created_at}">${formatDate(post.published_at || post.created_at)}</time>
        <span class="blog-post__meta-divider"></span>
        <span>${categoryLabel(post.category)}</span>
      </div>
    </header>

    ${featuredImageBlock}

    <div class="blog-post__content">
      ${post.content}
    </div>
  </article>

  <!-- NEWSLETTER CTA -->
  <section class="cta-section reveal" aria-labelledby="post-newsletter-heading">
    <div class="cta-section__inner">
      <div>
        <span class="section__label">Never Miss a Post</span>
        <h2 id="post-newsletter-heading" class="section__title">Get Updates by Email</h2>
        <p class="section__prose">Legislative alerts, Victory Garden news, and new blog posts — delivered only when it matters.</p>
      </div>
      <div>
        <form class="newsletter-form" aria-label="Newsletter signup" action="https://api.web3forms.com/submit" method="POST">
          <input type="hidden" name="access_key" value="5e7d5fb9-ab04-4c26-ac16-c3afea67cdf6">
          <input type="hidden" name="subject" value="New ICAN Newsletter Subscriber">
          <input type="hidden" name="redirect" value="https://iowacannabisaction.org/blog.html?subscribed=1">
          <input type="email" name="email" class="newsletter-form__input" placeholder="Your email address" aria-label="Email address" required>
          <button type="submit" class="btn btn--primary">Subscribe</button>
        </form>
        <p style="font-size: var(--text-xs); color: var(--color-text-faint); margin-top: var(--space-2);">No spam. Unsubscribe anytime.</p>
      </div>
    </div>
  </section>
</main>

<!-- FOOTER -->
<footer class="footer" role="contentinfo">
  <div class="footer__inner">
    <div class="footer__brand">
      <a href="../index.html" class="footer__logo" aria-label="ICAN Home">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" width="28" height="28">
          <path d="M16 2 C16 2 13 8 9 12 C5 16 4 20 6 24 C8 28 12 30 16 30 C20 30 24 28 26 24 C28 20 27 16 23 12 C19 8 16 2 16 2Z" fill="currentColor" opacity="0.9"/>
          <path d="M16 8 L16 24" stroke="var(--color-bg)" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M16 14 L12 11" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M16 14 L20 11" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M16 18 L11 15.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M16 18 L21 15.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M16 22 L12.5 19.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M16 22 L19.5 19.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span>ICAN</span>
      </a>
      <p class="footer__description">Iowa Cannabis Action Network, Inc. is a 501(c)(4) social welfare organization advancing responsible cannabis policy and community initiatives across Iowa.</p>
      <div class="footer__contact">
        2407 8th Ave SW, Altoona, IA 50009<br>
        <a href="tel:515-412-0511">515-412-0511</a><br>
        <a href="mailto:hello@iowacannabisaction.org">hello@iowacannabisaction.org</a>
      </div>
    </div>
    <div>
      <h3 class="footer__heading">Pages</h3>
      <ul class="footer__links" role="list">
        <li><a href="../index.html">Home</a></li>
        <li><a href="../about.html">About</a></li>
        <li><a href="../victory-garden.html">Victory Garden</a></li>
        <li><a href="../legislative.html">Legislative Updates</a></li>
        <li><a href="../blog.html">Blog</a></li>
        <li><a href="../get-involved.html">Get Involved</a></li>
      </ul>
    </div>
    <div>
      <h3 class="footer__heading">Connect</h3>
      <ul class="footer__links" role="list">
        <li><a href="https://www.facebook.com/61584583045381" target="_blank" rel="noopener noreferrer">Facebook</a></li>
        <li><a href="mailto:hello@iowacannabisaction.org">Email Us</a></li>
        <li><a href="../feed.xml">RSS Feed</a></li>
      </ul>
    </div>
  </div>
  <div class="footer__bottom">
    <p>&copy; 2026 Iowa Cannabis Action Network, Inc. All rights reserved.</p>
  </div>
</footer>

<button class="scroll-top" aria-label="Scroll to top">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
</button>

<script src="../app.js"></script>
</body>
</html>`;

  const filePath = path.join(BLOG_DIR, `${post.slug}.html`);
  fs.writeFileSync(filePath, html, 'utf8');
  console.log(`Generated: ${filePath}`);
}

function buildPostCards(posts) {
  let postsHTML = '';
  if (posts.length > 0) {
    const featured = posts[0];
    const featImg = featured.featured_image || 'assets/hero-prairie.png';
    postsHTML += `
      <article class="blog-card blog-card--featured reveal">
        <div class="blog-card__image-wrap">
          <img src="${featImg}" alt="${escapeXml(featured.title)}" class="blog-card__image" width="800" height="450" loading="lazy" decoding="async">
        </div>
        <div class="blog-card__body">
          <div class="blog-card__meta">
            <span class="blog-card__category">${categoryLabel(featured.category)}</span>
            <time class="blog-card__date" datetime="${featured.published_at}">${formatDateShort(featured.published_at)}</time>
          </div>
          <h3 class="blog-card__title">
            <a href="blog/${featured.slug}.html">${escapeXml(featured.title)}</a>
          </h3>
          <p class="blog-card__excerpt">${escapeXml(featured.excerpt || '')}</p>
          <a href="blog/${featured.slug}.html" class="blog-card__read-more">Read the full story</a>
        </div>
      </article>`;

    if (posts.length > 1) {
      postsHTML += '\n      <div class="blog-grid reveal-group">';
      for (let i = 1; i < posts.length; i++) {
        const p = posts[i];
        const pImg = p.featured_image || 'assets/hero-prairie.png';
        postsHTML += `
        <article class="blog-card reveal">
          <div class="blog-card__image-wrap">
            <img src="${pImg}" alt="${escapeXml(p.title)}" class="blog-card__image" width="400" height="225" loading="lazy" decoding="async">
          </div>
          <div class="blog-card__body">
            <div class="blog-card__meta">
              <span class="blog-card__category">${categoryLabel(p.category)}</span>
              <time class="blog-card__date" datetime="${p.published_at}">${formatDateShort(p.published_at)}</time>
            </div>
            <h3 class="blog-card__title">
              <a href="blog/${p.slug}.html">${escapeXml(p.title)}</a>
            </h3>
            <p class="blog-card__excerpt">${escapeXml(p.excerpt || '')}</p>
            <a href="blog/${p.slug}.html" class="blog-card__read-more">Read more</a>
          </div>
        </article>`;
      }
      postsHTML += '\n      </div>';
    }
  } else {
    postsHTML = '<p style="color: var(--color-text-muted); text-align: center; padding: var(--space-12) 0;">No posts yet. Check back soon!</p>';
  }
  return postsHTML;
}

function generateBlogHTML(postsHTML) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Blog — Iowa Cannabis Action Network</title>
<meta name="description" content="News, analysis, and updates from the Iowa Cannabis Action Network.">
<meta property="og:title" content="ICAN Blog">
<meta property="og:description" content="News, analysis, and updates from the Iowa Cannabis Action Network.">
<meta property="og:type" content="website">

<!-- Fonts -->
<link href="https://api.fontshare.com/v2/css?f[]=zodiak@400,500,600,700&display=swap" rel="stylesheet">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Work+Sans:wght@300..700&display=swap" rel="stylesheet">

<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg viewBox='0 0 32 32' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M16 2 C16 2 13 8 9 12 C5 16 4 20 6 24 C8 28 12 30 16 30 C20 30 24 28 26 24 C28 20 27 16 23 12 C19 8 16 2 16 2Z' fill='%232D6A3F'/%3E%3Cpath d='M16 8 L16 24' stroke='%23F5F3ED' stroke-width='1.5' stroke-linecap='round'/%3E%3Cpath d='M16 14 L12 11' stroke='%23F5F3ED' stroke-width='1.2' stroke-linecap='round'/%3E%3Cpath d='M16 14 L20 11' stroke='%23F5F3ED' stroke-width='1.2' stroke-linecap='round'/%3E%3Cpath d='M16 18 L11 15.5' stroke='%23F5F3ED' stroke-width='1.2' stroke-linecap='round'/%3E%3Cpath d='M16 18 L21 15.5' stroke='%23F5F3ED' stroke-width='1.2' stroke-linecap='round'/%3E%3C/svg%3E">
<link rel="alternate" type="application/rss+xml" title="ICAN Blog" href="feed.xml">
<link rel="stylesheet" href="base.css">
<link rel="stylesheet" href="style.css">
</head>
<body>

<a href="#main" class="skip-link">Skip to content</a>

<!-- HEADER -->
<header class="header" role="banner">
  <div class="header__inner">
    <a href="index.html" class="header__logo" aria-label="ICAN Home">
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" width="32" height="32">
        <path d="M16 2 C16 2 13 8 9 12 C5 16 4 20 6 24 C8 28 12 30 16 30 C20 30 24 28 26 24 C28 20 27 16 23 12 C19 8 16 2 16 2Z" fill="currentColor" opacity="0.9"/>
        <path d="M16 8 L16 24" stroke="var(--color-bg)" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M16 14 L12 11" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16 14 L20 11" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16 18 L11 15.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16 18 L21 15.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16 22 L12.5 19.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        <path d="M16 22 L19.5 19.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
      </svg>
      <span class="header__logo-text">ICAN</span>
    </a>
    <nav class="header__nav" aria-label="Main navigation">
      <a href="index.html" class="header__nav-link">Home</a>
      <a href="about.html" class="header__nav-link">About</a>
      <a href="victory-garden.html" class="header__nav-link">Victory Garden</a>
      <a href="legislative.html" class="header__nav-link">Legislative</a>
      <a href="blog.html" class="header__nav-link header__nav-link--active">Blog</a>
      <a href="get-involved.html" class="header__nav-link">Get Involved</a>
    </nav>
    <div class="header__actions">
      <button class="theme-toggle" data-theme-toggle aria-label="Switch to dark mode">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </button>
      <button class="mobile-menu-btn" aria-label="Open menu" aria-expanded="false">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
      </button>
    </div>
  </div>
</header>

<div class="mobile-nav" role="dialog" aria-label="Navigation menu">
  <button class="mobile-nav__close" aria-label="Close menu">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
  </button>
  <a href="index.html" class="mobile-nav__link">Home</a>
  <a href="about.html" class="mobile-nav__link">About</a>
  <a href="victory-garden.html" class="mobile-nav__link">Victory Garden</a>
  <a href="legislative.html" class="mobile-nav__link">Legislative</a>
  <a href="blog.html" class="mobile-nav__link mobile-nav__link--active">Blog</a>
  <a href="get-involved.html" class="mobile-nav__link">Get Involved</a>
</div>

<main id="main">
  <section class="blog-hero reveal">
    <h1 class="blog-hero__title">Blog</h1>
    <p class="blog-hero__subtitle">News, analysis, and updates from the Iowa Cannabis Action Network.</p>
  </section>

  <section class="blog-section" aria-labelledby="posts-heading">
    <div>
      <h2 id="posts-heading" class="sr-only">All Posts</h2>
${postsHTML}

    </div>
  </section>

  <!-- NEWSLETTER CTA -->
  <section class="cta-section reveal" aria-labelledby="blog-newsletter-heading">
    <div class="cta-section__inner">
      <div>
        <span class="section__label">Stay Connected</span>
        <h2 id="blog-newsletter-heading" class="section__title">Get Updates by Email</h2>
        <p class="section__prose">Legislative alerts, Victory Garden news, and new blog posts — delivered only when it matters.</p>
      </div>
      <div>
        <form class="newsletter-form" aria-label="Newsletter signup" action="https://api.web3forms.com/submit" method="POST">
          <input type="hidden" name="access_key" value="5e7d5fb9-ab04-4c26-ac16-c3afea67cdf6">
          <input type="hidden" name="subject" value="New ICAN Newsletter Subscriber">
          <input type="hidden" name="redirect" value="https://iowacannabisaction.org/blog.html?subscribed=1">
          <input type="email" name="email" class="newsletter-form__input" placeholder="Your email address" aria-label="Email address" required>
          <button type="submit" class="btn btn--primary">Subscribe</button>
        </form>
        <p style="font-size: var(--text-xs); color: var(--color-text-faint); margin-top: var(--space-2);">No spam. Unsubscribe anytime.</p>
      </div>
    </div>
  </section>
</main>

<!-- FOOTER -->
<footer class="footer" role="contentinfo">
  <div class="footer__inner">
    <div class="footer__brand">
      <a href="index.html" class="footer__logo" aria-label="ICAN Home">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" width="28" height="28">
          <path d="M16 2 C16 2 13 8 9 12 C5 16 4 20 6 24 C8 28 12 30 16 30 C20 30 24 28 26 24 C28 20 27 16 23 12 C19 8 16 2 16 2Z" fill="currentColor" opacity="0.9"/>
          <path d="M16 8 L16 24" stroke="var(--color-bg)" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M16 14 L12 11" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M16 14 L20 11" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M16 18 L11 15.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M16 18 L21 15.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M16 22 L12.5 19.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
          <path d="M16 22 L19.5 19.5" stroke="var(--color-bg)" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span>ICAN</span>
      </a>
      <p class="footer__description">Iowa Cannabis Action Network, Inc. is a 501(c)(4) social welfare organization advancing responsible cannabis policy and community initiatives across Iowa.</p>
      <div class="footer__contact">
        2407 8th Ave SW, Altoona, IA 50009<br>
        <a href="tel:515-412-0511">515-412-0511</a><br>
        <a href="mailto:hello@iowacannabisaction.org">hello@iowacannabisaction.org</a>
      </div>
    </div>
    <div>
      <h3 class="footer__heading">Pages</h3>
      <ul class="footer__links" role="list">
        <li><a href="index.html">Home</a></li>
        <li><a href="about.html">About</a></li>
        <li><a href="victory-garden.html">Victory Garden</a></li>
        <li><a href="legislative.html">Legislative Updates</a></li>
        <li><a href="blog.html">Blog</a></li>
        <li><a href="get-involved.html">Get Involved</a></li>
      </ul>
    </div>
    <div>
      <h3 class="footer__heading">Connect</h3>
      <ul class="footer__links" role="list">
        <li><a href="https://www.facebook.com/61584583045381" target="_blank" rel="noopener noreferrer">Facebook</a></li>
        <li><a href="mailto:hello@iowacannabisaction.org">Email Us</a></li>
        <li><a href="feed.xml">RSS Feed</a></li>
      </ul>
    </div>
  </div>
  <div class="footer__bottom">
    <p>&copy; 2026 Iowa Cannabis Action Network, Inc. All rights reserved.</p>
  </div>
</footer>

<button class="scroll-top" aria-label="Scroll to top">
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>
</button>

<script src="app.js"></script>
</body>
</html>`;
}

function updateBlogIndex(db) {
  const posts = db.prepare(`
    SELECT p.*, u.name as author_name
    FROM posts p LEFT JOIN users u ON p.author_id = u.id
    WHERE p.status = 'published'
    ORDER BY p.published_at DESC
  `).all();

  const blogHtmlPath = path.join(WEBSITE_DIR, 'blog.html');
  const postsHTML = buildPostCards(posts);

  // If blog.html doesn't exist, generate it from scratch
  if (!fs.existsSync(blogHtmlPath)) {
    fs.writeFileSync(blogHtmlPath, generateBlogHTML(postsHTML), 'utf8');
    console.log('Generated blog.html');
    return;
  }

  // If blog.html exists, try to update between markers
  let blogHtml = fs.readFileSync(blogHtmlPath, 'utf8');
  const sectionStart = '<h2 id="posts-heading" class="sr-only">All Posts</h2>';
  const sectionEnd = '</div>\n  </section>';

  const startIdx = blogHtml.indexOf(sectionStart);
  const endIdx = blogHtml.indexOf(sectionEnd, startIdx);

  if (startIdx !== -1 && endIdx !== -1) {
    blogHtml = blogHtml.substring(0, startIdx + sectionStart.length) + '\n' + postsHTML + '\n\n' + blogHtml.substring(endIdx);
    fs.writeFileSync(blogHtmlPath, blogHtml, 'utf8');
    console.log('Updated blog.html index');
  } else {
    // Markers not found, regenerate entirely
    fs.writeFileSync(blogHtmlPath, generateBlogHTML(postsHTML), 'utf8');
    console.log('Regenerated blog.html');
  }
}

function updateRSSFeed(db) {
  const posts = db.prepare(`
    SELECT p.*, u.name as author_name
    FROM posts p LEFT JOIN users u ON p.author_id = u.id
    WHERE p.status = 'published'
    ORDER BY p.published_at DESC
    LIMIT 20
  `).all();

  let items = '';
  for (const post of posts) {
    items += `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>https://iowacannabisaction.org/blog/${post.slug}.html</link>
      <guid>https://iowacannabisaction.org/blog/${post.slug}.html</guid>
      <pubDate>${formatRFC822(post.published_at)}</pubDate>
      <description>${escapeXml(post.excerpt || '')}</description>
      <category>${escapeXml(categoryLabel(post.category))}</category>
      <dc:creator>${escapeXml(post.author_name || 'ICAN Staff')}</dc:creator>
    </item>`;
  }

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>ICAN Blog — Iowa Cannabis Action Network</title>
    <link>https://iowacannabisaction.org/blog.html</link>
    <description>News, analysis, and updates from the Iowa Cannabis Action Network.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="https://iowacannabisaction.org/feed.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>`;

  const feedPath = path.join(WEBSITE_DIR, 'feed.xml');
  fs.writeFileSync(feedPath, feed, 'utf8');
  console.log('Updated feed.xml');
}

module.exports = { generatePostHTML, updateBlogIndex, updateRSSFeed };
