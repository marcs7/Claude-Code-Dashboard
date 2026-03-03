const express = require('express');
const router = express.Router();
const conversations = require('../services/conversations');

router.get('/', async (req, res) => {
  try {
    const projects = await conversations.getProjects();
    res.render('index', { projects });
  } catch (err) {
    console.error('Page index error:', err);
    res.render('index', { projects: [] });
  }
});

router.get('/conversation/:project/:sessionId', async (req, res) => {
  try {
    const { project, sessionId } = req.params;
    const convo = await conversations.getConversation(project, sessionId);
    if (!convo) return res.status(404).render('404');
    res.render('detail', { conversation: convo, project, sessionId });
  } catch (err) {
    if (err.isValidation) return res.status(404).render('404');
    console.error('Page conversation error:', err);
    res.status(500).render('500');
  }
});

module.exports = router;
