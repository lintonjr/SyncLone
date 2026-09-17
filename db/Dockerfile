# Runner de migrations. Roda como task avulsa, antes do deploy da aplicação.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Mesmo bundle de CAs do backend: o RDS exige TLS e o runner verifica o servidor.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
RUN chmod 444 /app/certs/rds-global-bundle.pem

COPY migrate.js ./
COPY src ./src
COPY init ./init
COPY migrations ./migrations

USER node
CMD ["node", "migrate.js"]
