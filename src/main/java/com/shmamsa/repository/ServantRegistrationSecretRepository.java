package com.shmamsa.repository;

import com.shmamsa.model.ServantRegistrationSecret;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.Optional;

public interface ServantRegistrationSecretRepository extends JpaRepository<ServantRegistrationSecret, Long> {

    Optional<ServantRegistrationSecret> findFirstByValidToAfterOrderByValidToDesc(LocalDateTime now);
}
