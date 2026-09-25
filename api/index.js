// Vercel Serverless Function — كل مسارات /api/* تُوجَّه هنا (انظر vercel.json)
const { handler } = require('../lib/api');
module.exports = handler;
