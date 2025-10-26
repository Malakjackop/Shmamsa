package com.shmamsa.validation.customAnnotation;

import com.shmamsa.model.User;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class DifferentParentPhonesValidator implements ConstraintValidator<DifferentParentPhones, User> {

    @Override
    public boolean isValid(User user, ConstraintValidatorContext context) {
        if (user == null) return true;
        String father = user.getFatherPhone();
        String mother = user.getMotherPhone();

        if (father == null || mother == null) return true;

        return !father.equals(mother);
    }
}
