var nameService = require('njord-ns-server');

const {lookup} = require('bragi-ns-client');

lookup('hu.hu', {all: true}, (error, results) => {
   // results is an array that contains both IPv4 and IPv6 addresses (Ipv4 first).
   //
   // error - null
   // results - [
   //   { address: '1.2.3.4', family: 4 },
   //   { address: '5.6.7.8', family: 4 }
   // ]

   console.log(results);
});



module.exports.lookup = lookup;
