// An error that carries the HTTP status the API should answer with.
class HttpError extends Error {
    constructor(status, message, details) {
        super(message);
        this.status = status;
        this.details = details;
    }
}

module.exports = HttpError;
