FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p uploads

# Bundle de CAs da RDS.
#
# As autoridades da RDS não estão no armazenamento de confiança do sistema, então
# sem este arquivo `DB_SSL=true` não tem como verificar o servidor — e o backend
# recusa subir (src/lib/config.js), de propósito. Fica dentro da imagem para o
# start da task não depender de rede, e para o mesmo artefato ser verificável.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/certs/rds-global-bundle.pem
RUN chmod 444 /app/certs/rds-global-bundle.pem

EXPOSE 3001
CMD ["node", "src/app.js"]
