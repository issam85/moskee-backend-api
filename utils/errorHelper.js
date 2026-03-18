// utils/errorHelper.js
const sendError = (res, statusCode, message, details = null, req = null) => {
  const pathInfo = req ? `${req.method} ${req.originalUrl}` : '(Unknown path)';
  // Always log full details server-side for debugging
  console.error(`Error ${statusCode} in ${pathInfo}: ${message}`, details || '');
  // Never expose internal error details to the client
  res.status(statusCode).json({ success: false, error: message });
};

module.exports = { sendError };