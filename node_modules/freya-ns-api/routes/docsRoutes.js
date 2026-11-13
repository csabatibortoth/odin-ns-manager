const express = require('express');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');

const openapi = require('../docs/openapi');

// The description of the API, and a page to try it from: Swagger UI. Both are served without
// signing in, as they hold no data; the requests the page sends need a token like any other.
const router = express.Router();

router.get('/openapi.json', (req, res) => {
    res.json(openapi);
});

// The page must also load over plain HTTP from another machine, which the default policy
// of helmet prevents by upgrading every request of the page to HTTPS.
router.use(
    helmet.contentSecurityPolicy({
        directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'upgrade-insecure-requests': null },
    })
);
router.use(swaggerUi.serve);
router.get(
    '/',
    swaggerUi.setup(openapi, {
        customSiteTitle: openapi.info.title,
        swaggerOptions: { persistAuthorization: true },
    })
);

module.exports = router;
