# Use the official Node.js image as the base image
FROM node:20

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install the application dependencies
RUN npm install -g npm@latest && \
    npm install -g ts-node && \
    npm install

# Copy Prisma schema
COPY prisma ./prisma/

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the application files
COPY . .

# Build the NestJS application
RUN npm run build

# Copy and make the start script executable
COPY start.sh ./
RUN chmod +x start.sh

# Expose the application port
EXPOSE 3000

# Command to run the application
CMD ["./start.sh"]

