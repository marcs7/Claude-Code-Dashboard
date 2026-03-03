const express = require('express');
const router = express.Router();
const conversations = require('../services/conversations');

router.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

router.get('/conversations', async (req, res) => {
  try {
    const { search, project, page = 1, limit = 50 } = req.query;
    const result = await conversations.listConversations({
      search,
      project,
      page: parseInt(page),
      limit: parseInt(limit)
    });
    res.json(result);
  } catch (err) {
    console.error('List error:', err);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

router.delete('/conversations/bulk', async (req, res) => {
  try {
    const { search, project, sessionIds } = req.body || {};
    if (!sessionIds && !search && !project) {
      return res.status(400).json({ error: 'Provide sessionIds or search/project filter params' });
    }
    if (sessionIds && sessionIds.length > 200) {
      return res.status(400).json({ error: 'Cannot delete more than 200 conversations at once' });
    }
    const result = await conversations.bulkDeleteConversations({ search, project, sessionIds });
    if (!result) {
      return res.status(400).json({ error: 'Provide sessionIds or search/project filter params' });
    }
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('Bulk delete error:', err);
    res.status(500).json({ error: 'Failed to bulk delete conversations' });
  }
});

router.get('/conversations/:project/:sessionId', async (req, res) => {
  try {
    const { project, sessionId } = req.params;
    const messages = await conversations.getConversation(project, sessionId);
    if (!messages) return res.status(404).json({ error: 'Not found' });
    res.json(messages);
  } catch (err) {
    if (err.isValidation) return res.status(400).json({ error: err.message });
    console.error('Get error:', err);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
});

router.delete('/conversations/:project/:sessionId', async (req, res) => {
  try {
    const { project, sessionId } = req.params;
    const result = await conversations.deleteConversation(project, sessionId);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) {
    if (err.isValidation) return res.status(400).json({ error: err.message });
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

router.get('/metrics', async (req, res) => {
  try {
    const metrics = await conversations.getMetrics();
    res.json(metrics);
  } catch (err) {
    console.error('Metrics error:', err);
    res.status(500).json({ error: 'Failed to compute metrics' });
  }
});

router.get('/conversations/:project/:sessionId/export', async (req, res) => {
  try {
    const { project, sessionId } = req.params;
    const { format = 'json' } = req.query;
    const data = await conversations.exportConversation(project, sessionId, format);
    if (!data) return res.status(404).json({ error: 'Not found' });

    const filename = `cc-${sessionId}.${format === 'md' ? 'md' : 'jsonl'}`;
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.set('Content-Type', format === 'md' ? 'text/markdown' : 'application/jsonl');
    res.send(data);
  } catch (err) {
    if (err.isValidation) return res.status(400).json({ error: err.message });
    console.error('Export error:', err);
    res.status(500).json({ error: 'Failed to export conversation' });
  }
});

module.exports = router;
