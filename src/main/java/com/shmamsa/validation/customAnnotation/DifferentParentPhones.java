package com.shmamsa.validation.customAnnotation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;

import java.lang.annotation.*;

@Documented
@Constraint(validatedBy = DifferentParentPhonesValidator.class)
@Target({ ElementType.TYPE })
@Retention(RetentionPolicy.RUNTIME)
public @interface DifferentParentPhones {
    String message() default "Father phone and mother phone cannot be the same";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
}
