FROM node:20

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm cache clean --force
RUN npm install

# Copy the rest of the application code
COPY . .

# Generate Prisma Client code
RUN npx prisma generate

# Build the NestJS application
RUN npm run build

# Expose the port the app runs on, here, I was using port 3333
EXPOSE 3333

# Command to run the app
CMD [  "npm", "run", "start:migrate:prod" ]