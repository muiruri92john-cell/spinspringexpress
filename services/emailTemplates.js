// services/emailTemplates.js
const ejs = require('ejs');
const path = require('path');

const TEMPLATE_DIR = path.join(__dirname, '..', 'views', 'emails');

async function renderTemplate(templateName, data = {}) {
  const file = path.join(TEMPLATE_DIR, `${templateName}.ejs`);
  const html = await ejs.renderFile(file, {
    appName: process.env.APP_NAME || 'SpinSpring Express',
    appUrl: process.env.APP_URL || 'https://spinspringexpress.co.ke',
    year: new Date().getFullYear(),
    ...data,
  });
  return html;
}

module.exports = { renderTemplate };