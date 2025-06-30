// utils/logger.js - Secure logging utility
const isProduction = process.env.NODE_ENV === 'production';

// List of sensitive keywords that should never be logged in production
const SENSITIVE_KEYWORDS = [
    'password', 'token', 'secret', 'key', 'api_key', 'client_secret',
    'authorization', 'bearer', 'jwt', 'cookie', 'session'
];

// Check if a string contains sensitive information
const containsSensitiveInfo = (str) => {
    if (typeof str !== 'string') return false;
    const lowerStr = str.toLowerCase();
    return SENSITIVE_KEYWORDS.some(keyword => lowerStr.includes(keyword));
};

// Sanitize log message to remove sensitive data
const sanitizeLogMessage = (message) => {
    if (typeof message === 'object') {
        try {
            const sanitized = JSON.parse(JSON.stringify(message));
            // Remove sensitive fields from objects
            const removeKeys = (obj) => {
                if (typeof obj === 'object' && obj !== null) {
                    Object.keys(obj).forEach(key => {
                        if (containsSensitiveInfo(key)) {
                            obj[key] = '[REDACTED]';
                        } else if (typeof obj[key] === 'object') {
                            removeKeys(obj[key]);
                        }
                    });
                }
            };
            removeKeys(sanitized);
            return sanitized;
        } catch (e) {
            return '[OBJECT_SERIALIZATION_ERROR]';
        }
    }
    
    if (typeof message === 'string' && containsSensitiveInfo(message)) {
        return '[SENSITIVE_DATA_REDACTED]';
    }
    
    return message;
};

// Secure logger functions
const logger = {
    log: (...args) => {
        if (isProduction) {
            const sanitized = args.map(sanitizeLogMessage);
            console.log(...sanitized);
        } else {
            console.log(...args);
        }
    },
    
    error: (...args) => {
        if (isProduction) {
            const sanitized = args.map(sanitizeLogMessage);
            console.error(...sanitized);
        } else {
            console.error(...args);
        }
    },
    
    warn: (...args) => {
        if (isProduction) {
            const sanitized = args.map(sanitizeLogMessage);
            console.warn(...sanitized);
        } else {
            console.warn(...args);
        }
    },
    
    info: (...args) => {
        if (isProduction) {
            const sanitized = args.map(sanitizeLogMessage);
            console.info(...sanitized);
        } else {
            console.info(...args);
        }
    },
    
    debug: (...args) => {
        // Debug logs only in development
        if (!isProduction) {
            console.debug('[DEBUG]', ...args);
        }
    }
};

module.exports = logger;