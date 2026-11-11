const mongoose = require('mongoose');
const config = require('../../config/config');

function buildUri() {
    if (config.modelServerUri) return config.modelServerUri;

    const credentials = config.modelServerUser
        ? `${encodeURIComponent(config.modelServerUser)}:${encodeURIComponent(config.modelServerPwd)}@`
        : '';
    return `mongodb://${credentials}${config.modelServerAddress}:${config.modelServerPort}/${config.modelServerDataBase}`;
}

async function connectToDB(uri = buildUri()) {
    // Fail fast instead of buffering queries while the server is unreachable.
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    // Unique indexes must exist before the first write relies on them.
    await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
    return mongoose.connection;
}

function disconnectFromDB() {
    return mongoose.disconnect();
}

module.exports = {
    connectToDB,
    disconnectFromDB,
    User: require('./userModel'),
};
