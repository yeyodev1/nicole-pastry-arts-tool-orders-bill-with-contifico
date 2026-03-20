import { sign, verify } from "jsonwebtoken";

export const JWT_SECRET = process.env.JWT_SECRET || "token.01010101";

const generateToken = async (user: any) => {
  const jwt = sign(
    {
      id: user._id || user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      contificoSource: user.contificoSource || 'nicole'
    },
    JWT_SECRET,
    {
      expiresIn: "12h", // Increased for better UX in sales tools
    }
  );
  return jwt;
};

const verifyToken = async (jwt: string) => {
  const isOk = verify(jwt, JWT_SECRET);
  return isOk;
};

export { generateToken, verifyToken };
