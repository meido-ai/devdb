import { Request, Response, NextFunction } from 'express';

export const releaseHeader = (req: Request, res: Response, next: NextFunction) => {
  const release = process.env.RELEASE_VERSION || 'unknown';
  res.setHeader('X-Release', release);
  next();
};
