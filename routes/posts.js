const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generatePostHTML, updateBlogIndex, updateRSSFeed } = require('../lib/static-gen');
const router = express.Router();

const quillHead = `<link href="https://cdn.quilljs.com/1.3.7/quill.snow.css" rel="stylesheet">`;
const quillScripts = `
<script src="https://cdn.quilljs.com/1.3.7/quill.min.js"></script>
<script>
  const quill = new Quill('#quill-editor', {
    theme: 'snow',
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['blockquote', 'code-block'],
        ['link', 'image'],
        [{ align: [] }],
        ['clean']
      ]
    },
    placeholder: 'Write your post content here...'
  });

  document.getElementById('postForm').addEventListener('submit', function() {
    document.getElementById('content').value = quill.root.innerHTML;
  });

  function generateSlug(title) {
    const slug = title.toLowerCase()
      .replace(/[^a-z0-9\\s-]/g, '')
      .replace(/\\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    document.getElementById('slug').value = slug;
  }
</script>`;

// List posts
router.get('/', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const status = req.query.status || '';
  const category = req.query.category || '';

  let query = 'SELECT p.*, u.name as author_name FROM posts p LEFT JOIN users u ON p.author_id = u.id';
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push('p.status = ?');
    params.push(status);
  }
  if (category) {
    conditions.push('p.category = ?');
    params.push(category);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY p.updated_at DESC';

  const posts = db.prepare(query).all(...params);
  res.render('posts/index', { title: 'Blog Posts', posts, filters: { status, category } });
});

// New post form
router.get('/new', requireRole('admin', 'editor'), (req, res) => {
  res.render('posts/editor', {
    title: 'New Post',
    post: { id: null, title: '', slug: '', content: '', excerpt: '', category: '', featured_image: '', status: 'draft' },
    isNew: true,
    head: quillHead,
    scripts: quillScripts
  });
});

// Create post
router.post('/', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { title, slug, content, excerpt, category, featured_image, status } = req.body;

  if (!title || !slug || !content) {
    req.session.flash = { type: 'error', message: 'Title, slug, and content are required.' };
    return res.redirect('/admin/posts/new');
  }

  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const publishedAt = status === 'published' ? new Date().toISOString() : null;

  try {
    const result = db.prepare(`
      INSERT INTO posts (title, slug, content, excerpt, category, featured_image, status, author_id, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, cleanSlug, content, excerpt || null, category || null, featured_image || null, status || 'draft', req.session.userId, publishedAt);

    if (status === 'published') {
      const post = db.prepare('SELECT p.*, u.name as author_name FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.id = ?').get(result.lastInsertRowid);
      generatePostHTML(post);
      updateBlogIndex(db);
      updateRSSFeed(db);
    }

    req.session.flash = { type: 'success', message: 'Post created successfully.' };
    res.redirect('/admin/posts');
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      req.session.flash = { type: 'error', message: 'A post with that slug already exists.' };
    } else {
      req.session.flash = { type: 'error', message: 'Failed to create post.' };
    }
    res.redirect('/admin/posts/new');
  }
});

// Edit post form
router.get('/:id/edit', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) {
    req.session.flash = { type: 'error', message: 'Post not found.' };
    return res.redirect('/admin/posts');
  }
  res.render('posts/editor', { title: 'Edit Post', post, isNew: false, head: quillHead, scripts: quillScripts });
});

// Update post
router.post('/:id', requireRole('admin', 'editor'), (req, res) => {
  const db = req.app.locals.db;
  const { title, slug, content, excerpt, category, featured_image, status } = req.body;
  const postId = req.params.id;

  const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(postId);
  if (!existing) {
    req.session.flash = { type: 'error', message: 'Post not found.' };
    return res.redirect('/admin/posts');
  }

  const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const wasPublished = existing.status === 'published';
  const isPublishing = status === 'published';
  const publishedAt = isPublishing && !wasPublished ? new Date().toISOString() : existing.published_at;

  try {
    db.prepare(`
      UPDATE posts SET title = ?, slug = ?, content = ?, excerpt = ?, category = ?, featured_image = ?,
      status = ?, published_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(title, cleanSlug, content, excerpt || null, category || null, featured_image || null, status || 'draft', publishedAt, postId);

    if (isPublishing) {
      const post = db.prepare('SELECT p.*, u.name as author_name FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.id = ?').get(postId);
      generatePostHTML(post);
      updateBlogIndex(db);
      updateRSSFeed(db);
    }

    req.session.flash = { type: 'success', message: 'Post updated successfully.' };
    res.redirect('/admin/posts');
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      req.session.flash = { type: 'error', message: 'A post with that slug already exists.' };
    } else {
      req.session.flash = { type: 'error', message: 'Failed to update post.' };
    }
    res.redirect(`/admin/posts/${postId}/edit`);
  }
});

// Preview post
router.get('/:id/preview', requireAuth, (req, res) => {
  const db = req.app.locals.db;
  const post = db.prepare('SELECT p.*, u.name as author_name FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.id = ?').get(req.params.id);
  if (!post) {
    req.session.flash = { type: 'error', message: 'Post not found.' };
    return res.redirect('/admin/posts');
  }
  res.render('posts/preview', { title: 'Preview: ' + post.title, post });
});

// Delete post
router.post('/:id/delete', requireRole('admin'), (req, res) => {
  const db = req.app.locals.db;
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);

  if (post) {
    db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);

    // Remove static file if it exists
    const fs = require('fs');
    const path = require('path');
    const staticPath = path.join(__dirname, '..', '..', 'ican-website', 'blog', `${post.slug}.html`);
    if (fs.existsSync(staticPath)) {
      fs.unlinkSync(staticPath);
    }

    updateBlogIndex(db);
    updateRSSFeed(db);
    req.session.flash = { type: 'success', message: 'Post deleted.' };
  }

  res.redirect('/admin/posts');
});

module.exports = router;
