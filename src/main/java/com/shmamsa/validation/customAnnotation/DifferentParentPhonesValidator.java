package com.shmamsa.validation.customAnnotation;

import com.shmamsa.model.User;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class DifferentParentPhonesValidator implements ConstraintValidator<DifferentParentPhones, User> {

    @Override
    public boolean isValid(User user, ConstraintValidatorContext context) {
        if (user == null) return true;

        String guardianPhone = user.getGuardiansPhone();
        String userPhone = user.getPhoneNumber();

        if (guardianPhone == null || userPhone == null) return true;

        return !guardianPhone.equals(userPhone);
    }

}
