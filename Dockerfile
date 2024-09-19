# Use the official Node.js image
FROM node:20-alpine

# Create and set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Start the monitoring script in the background and then run the Node.js application
CMD ["/bin/sh", "-c", "node index.js"]