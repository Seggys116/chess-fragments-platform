'use client';

import { useEffect, useRef } from 'react';

export default function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Particle/orb configuration
    const orbs = Array.from({ length: 5 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 200 + 100,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      color: `hsla(${Math.random() * 60 + 270}, 70%, 50%, 0.1)`, // Purple hues
    }));

    // Animation loop
    let animationId: number;
    const animate = () => {
      // Dark background
      ctx.fillStyle = 'rgb(15, 15, 25)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw orbs
      orbs.forEach((orb) => {
        // Update position
        orb.x += orb.vx;
        orb.y += orb.vy;

        // Bounce off edges
        if (orb.x < -orb.radius) orb.x = canvas.width + orb.radius;
        if (orb.x > canvas.width + orb.radius) orb.x = -orb.radius;
        if (orb.y < -orb.radius) orb.y = canvas.height + orb.radius;
        if (orb.y > canvas.height + orb.radius) orb.y = -orb.radius;

        // Draw gradient orb
        const gradient = ctx.createRadialGradient(
          orb.x,
          orb.y,
          0,
          orb.x,
          orb.y,
          orb.radius
        );
        gradient.addColorStop(0, orb.color.replace('0.1', '0.3'));
        gradient.addColorStop(0.5, orb.color.replace('0.1', '0.1'));
        gradient.addColorStop(1, 'transparent');

        ctx.fillStyle = gradient;
        ctx.fillRect(
          orb.x - orb.radius,
          orb.y - orb.radius,
          orb.radius * 2,
          orb.radius * 2
        );
      });

      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full pointer-events-none"
      style={{
        zIndex: 0,
        background: 'linear-gradient(to bottom right, rgb(15, 15, 25), rgb(25, 15, 35), rgb(15, 15, 25))'
      }}
    />
  );
}