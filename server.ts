import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '3000', 10);
const host = '0.0.0.0';

const publicDir = path.join(__dirname, 'public');
const indexPath = path.join(publicDir, 'index.html');
const imagePath = path.join(publicDir, 'main.jpg');

// Actuator health check endpoints
app.get('/actuator/health', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    status: 'UP',
    components: {
      diskSpace: {
        status: 'UP',
        details: {
          total: 10737418240,
          free: 5368709120,
          threshold: 10485760,
          exists: true
        }
      },
      ping: {
        status: 'UP'
      },
      livenessState: {
        status: 'UP'
      },
      readinessState: {
        status: 'UP'
      }
    },
    groups: ['liveness', 'readiness']
  });
});

app.get('/actuator/health/liveness', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({ status: 'UP' });
});

app.get('/actuator/health/readiness', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.json({ status: 'UP' });
});

// Explicit image endpoint matching Spring static resource
app.get('/main.jpg', (_req: Request, res: Response) => {
  if (fs.existsSync(imagePath)) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.sendFile(imagePath);
  } else {
    res.status(404).send('Not found');
  }
});

// Single application HTML page
app.get('/', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=UTF-8');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>DevOps Test Task</title>
</head>
<body>
    <h1>DevOps test task</h1>
    <img src="/main.jpg" alt="main.jpg">
</body>
</html>`);
  }
});

// Serve static assets from public folder
app.use(express.static(publicDir));

app.listen(port, host, () => {
  console.log(`Server is running at http://${host}:${port}`);
});
