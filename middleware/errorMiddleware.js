// middleware/errorMiddleware.js
const { sendError } = require('../utils/errorHelper');

// Vangt alle routes op die niet gematcht zijn
const routeNotFoundHandler = (req, res) => {
  sendError(res, 404, 'Route not found.', { path: req.originalUrl, method: req.method }, req);
};

// Globale error handler die aan het einde van de middleware chain wordt aangeroepen
const globalErrorHandler = (error, req, res, next) => {
  console.error('❌ Unhandled Server Error:', error.stack || error);
  
  const statusCode = error.status || 500;
  const message = (process.env.NODE_ENV === 'production' && statusCode === 500)
    ? 'Interne serverfout.'
    : error.message;

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { details: error.stack })
  });
};

module.exports = {
  routeNotFoundHandler,
  globalErrorHandler
};