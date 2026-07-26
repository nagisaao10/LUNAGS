import com.resend.*;

public class Main {
    public static void main(String[] args) {
        Resend resend = new Resend("${RESEND_API_KEY}");

        SendEmailRequest sendEmailRequest = SendEmailRequest.builder()
                .from("onboarding@resend.dev")
                .to("nagisa.ito121001m@gmail.com")
                .subject("Hello World")
                .html("<p>Congrats on sending your <strong>first email</strong>!</p>")
                .build();

        SendEmailResponse data = resend.emails().send(sendEmailRequest);

        System.out.println("送信完了: " + data.getId());
    }
}