const swaggerAutogen = require('swagger-autogen')();

const doc = {
  info: {
    title: 'DevDB API',
    description: 'API for managing database instances in Kubernetes',
    version: '1.0.0',
  },
  host: 'localhost:5000',
  schemes: ['http'],
};

const outputFile = './swagger-output.json';
const endpointsFiles = ['./src/app.ts'];

swaggerAutogen(outputFile, endpointsFiles, doc);