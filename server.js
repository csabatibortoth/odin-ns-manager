var njord = require('njord-ns-server');
var server = njord.createServer();
var ttl = 300;

server.listen(9999, '127.0.0.1', function() {
  console.log('DNS server started on port 9999');
});

server.on('query', function(query) {
  var domain = query.name();
  console.log('DNS Query: %s', domain)
  var target = new named.SOARecord(domain, {serial: 12345});
  query.addAnswer(domain, target, ttl);
  server.send(query);
});
