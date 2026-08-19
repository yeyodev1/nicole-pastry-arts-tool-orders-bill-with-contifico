import { Resend } from "resend";

const FROM_ADDRESS = process.env.EMAIL_FROM || "Nicole Pastry Arts <app@nicole.com.ec>";

export class EmailService {
  private resend: Resend;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  /**
   * Envía el correo de recuperación de contraseña con el link de reset.
   */
  async sendPasswordResetEmail(to: string, userName: string, resetUrl: string) {
    const html = `
<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background-color:#faf7f2;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#faf7f2;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:40px;box-shadow:0 4px 12px rgba(124,58,237,0.08);">
          <tr>
            <td align="center" style="padding-bottom:24px;">
              <h1 style="margin:0;color:#7c3aed;font-size:22px;">Nicole Pastry Arts</h1>
              <p style="margin:4px 0 0;color:#9ca3af;font-size:13px;">Sistema de Pedidos</p>
            </td>
          </tr>
          <tr>
            <td style="color:#374151;font-size:15px;line-height:1.6;">
              <p>Hola${userName ? ` <strong>${userName}</strong>` : ""},</p>
              <p>Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón para crear una nueva:</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 0;">
              <a href="${resetUrl}" style="background:#7c3aed;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:10px;font-weight:bold;font-size:15px;display:inline-block;">
                Restablecer contraseña
              </a>
            </td>
          </tr>
          <tr>
            <td style="color:#6b7280;font-size:13px;line-height:1.6;">
              <p>Este enlace es válido por <strong>1 hora</strong>. Si no solicitaste este cambio, puedes ignorar este correo — tu contraseña seguirá siendo la misma.</p>
              <p style="margin-bottom:0;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
              <a href="${resetUrl}" style="color:#7c3aed;word-break:break-all;">${resetUrl}</a></p>
            </td>
          </tr>
        </table>
        <p style="color:#9ca3af;font-size:12px;margin-top:16px;">© Nicole Pastry Arts · app.nicole.com.ec</p>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const { data, error } = await this.resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: "Restablece tu contraseña — Nicole Pastry Arts",
      html,
    });

    if (error) {
      console.error("❌ Error enviando email de reset:", error);
      throw new Error("EMAIL_SEND_FAILED");
    }

    return data;
  }
}
