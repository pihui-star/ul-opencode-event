  
## Nodemailer Import Issue  
- Default import `import nodemailer from 'nodemailer'` fails  
- Fix: Use `import * as nodemailer from 'nodemailer'`  
  
## SentMessageInfo Type  
- nodemailer sendMail must return SentMessageInfo with envelope, message, accepted, rejected, pending 
