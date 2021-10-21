var nameService = require('njord-ns-server');
var nameServer = nameService.createServer();
var config = require('./config/config.js');
var searchService = require('./services/serverService/searchService.js');
var dnsClient = require('dns-client');
const {lookup} = require('bragi-ns-client');
var ttl = 300;

if(config.logingEnabled) var logService = require("./services/logService/logService");

nameServer.listen(config.nsServerPort, config.serverIPAddress, function() {
  console.log('DNS server started on ' + config.serverIPAddress + ' port ' + config.nsServerPort );
});

function between(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1) + min
  )
}

nameServer.on('query', function(query) {

  function test(){

  }

  var domain = query.name();
  var type = query.type();
  console.log('DNS Query: %s', domain)
  console.log('DNS Query domain type: %s', type);
  if(config.logingEnabled) logService.addInfoLogBasicInfoEntry('DNS Query: %s', domain);
  if(config.logingEnabled) logService.addInfoLogBasicInfoEntry('DNS Query domain type: %s', type);


    let client = new dnsClient();

    client.setUpServers('1.1.1.1',between(20000,50000),_=>{
        client.on("result",function(data){
            console.log(data.answers)//{answers:[],'name-servers':[],'addtional-records':[]}
            client.close();

        });
        client.resolve(domain,type);
    });






});
